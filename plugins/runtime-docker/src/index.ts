import Docker from "dockerode";
import type {
  IRuntimeProvider,
  RuntimeSpec,
  RuntimeHandle,
  ExecResult,
  HealthStatus,
  PluginModule,
} from "@clawdia/types";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export class DockerRuntimeProvider implements IRuntimeProvider {
  readonly name = "docker";
  private startTimes = new Map<string, number>();

  async spawn(spec: RuntimeSpec): Promise<RuntimeHandle> {
    const image = spec.image ?? "node:20-slim";

    // Pull the image if not available locally
    await this.ensureImage(image);

    const hostConfig: Docker.HostConfig = {
      Memory: spec.memoryMb ? spec.memoryMb * 1024 * 1024 : undefined,
      NanoCpus: spec.cpus ? spec.cpus * 1e9 : undefined,
      NetworkMode: spec.network,
      Binds: spec.volumes?.map(
        (v) => `${v.host}:${v.container}${v.readonly ? ":ro" : ""}`,
      ),
    };

    const envList = spec.env
      ? Object.entries(spec.env).map(([k, v]) => `${k}=${v}`)
      : [];

    const container = await docker.createContainer({
      Image: image,
      name: spec.name,
      Env: envList,
      Cmd: spec.command ?? ["tail", "-f", "/dev/null"],
      HostConfig: hostConfig,
      Labels: {
        "clawdia.managed": "true",
        "clawdia.agent": spec.name,
      },
    });

    await container.start();

    const id = container.id;
    this.startTimes.set(id, Date.now());

    return { id, name: spec.name, runtime: this.name };
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    try {
      const container = docker.getContainer(handle.id);
      try {
        await container.stop({ t: 5 });
      } catch {
        // Container may already be stopped
      }
      await container.remove({ force: true });
    } catch {
      // Container may already be removed
    }
    this.startTimes.delete(handle.id);
  }

  async exec(handle: RuntimeHandle, cmd: string): Promise<ExecResult> {
    const container = docker.getContainer(handle.id);
    const exec = await container.exec({
      Cmd: ["sh", "-c", cmd],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Tty: false });

    const { stdout, stderr } = await collectStream(stream);

    const inspection = await exec.inspect();
    const exitCode = inspection.ExitCode ?? 1;

    return { stdout, stderr, exitCode };
  }

  async *logs(handle: RuntimeHandle): AsyncIterable<string> {
    const container = docker.getContainer(handle.id);
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 100,
    });

    // Docker log stream has 8-byte header per frame
    const readable = demuxStream(stream);
    for await (const chunk of readable) {
      yield chunk;
    }
  }

  async healthCheck(handle: RuntimeHandle): Promise<HealthStatus> {
    try {
      const container = docker.getContainer(handle.id);
      const info = await container.inspect();
      const running = info.State?.Running ?? false;
      const startTime = this.startTimes.get(handle.id) ?? Date.now();

      if (!running) {
        return { alive: false, uptime: 0 };
      }

      // Get resource usage from container stats
      const stats = await container.stats({ stream: false });
      const memoryUsedMb = stats.memory_stats?.usage
        ? stats.memory_stats.usage / (1024 * 1024)
        : undefined;

      let cpuPercent: number | undefined;
      if (stats.cpu_stats?.cpu_usage?.total_usage !== undefined &&
          stats.precpu_stats?.cpu_usage?.total_usage !== undefined) {
        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage -
          stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta =
          (stats.cpu_stats.system_cpu_usage ?? 0) -
          (stats.precpu_stats.system_cpu_usage ?? 0);
        const numCpus = stats.cpu_stats.online_cpus ?? 1;
        if (systemDelta > 0) {
          cpuPercent = (cpuDelta / systemDelta) * numCpus * 100;
        }
      }

      return {
        alive: true,
        uptime: Date.now() - startTime,
        memoryUsedMb: memoryUsedMb ? Math.round(memoryUsedMb * 100) / 100 : undefined,
        cpuPercent: cpuPercent ? Math.round(cpuPercent * 100) / 100 : undefined,
      };
    } catch {
      return { alive: false, uptime: 0 };
    }
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await docker.getImage(image).inspect();
    } catch {
      // Image not found locally — pull it
      const stream = await docker.pull(image);
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(
          stream,
          (err: Error | null) => (err ? reject(err) : resolve()),
        );
      });
    }
  }
}

// ─── Stream helpers ───

function collectStream(stream: NodeJS.ReadableStream): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stdoutBufs: Buffer[] = [];
    const stderrBufs: Buffer[] = [];

    stream.on("data", (chunk: Buffer) => {
      // Docker multiplexed stream: 8-byte header per frame
      // header[0] = stream type (0=stdin, 1=stdout, 2=stderr)
      // header[4..7] = payload size (big-endian uint32)
      let offset = 0;
      while (offset < chunk.length) {
        if (offset + 8 > chunk.length) break;
        const type = chunk[offset];
        const size = chunk.readUInt32BE(offset + 4);
        const payload = chunk.subarray(offset + 8, offset + 8 + size);
        if (type === 2) {
          stderrBufs.push(payload);
        } else {
          stdoutBufs.push(payload);
        }
        offset += 8 + size;
      }
    });

    stream.on("end", () => {
      resolve({
        stdout: Buffer.concat(stdoutBufs).toString("utf-8"),
        stderr: Buffer.concat(stderrBufs).toString("utf-8"),
      });
    });

    stream.on("error", reject);
  });
}

async function* demuxStream(stream: NodeJS.ReadableStream): AsyncIterable<string> {
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    // Docker log stream has 8-byte header per frame
    let offset = 0;
    while (offset < chunk.length) {
      if (offset + 8 > chunk.length) {
        yield chunk.subarray(offset).toString("utf-8");
        break;
      }
      const size = chunk.readUInt32BE(offset + 4);
      const payload = chunk.subarray(offset + 8, offset + 8 + size);
      yield payload.toString("utf-8");
      offset += 8 + size;
    }
  }
}

// ─── Plugin export ───

export default {
  name: "docker",
  type: "runtime",
  create: () => new DockerRuntimeProvider(),
} satisfies PluginModule<DockerRuntimeProvider>;
