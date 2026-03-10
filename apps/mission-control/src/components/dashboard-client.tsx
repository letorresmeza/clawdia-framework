"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Agent,
  AgentMode,
  AgentStatus,
  DashboardPayload,
  TaskState,
} from "@/lib/mission-control";

const emptyDashboard: DashboardPayload = {
  version: 0,
  updatedAt: "",
  agents: [],
  events: [],
  contracts: [],
  tasks: [],
};

const taskStateOrder: TaskState[] = ["Ready", "Queued", "Running", "Blocked", "Done"];

export function DashboardClient() {
  const [dashboard, setDashboard] = useState<DashboardPayload>(emptyDashboard);
  const [sessionUser, setSessionUser] = useState<string | null>(null);
  const [authForm, setAuthForm] = useState({ username: "admin", password: "" });
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [filter, setFilter] = useState<"All" | AgentStatus>("All");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [taskDrafts, setTaskDrafts] = useState<
    Record<string, { label: string; owner: string; state: TaskState }>
  >({});
  const [eventDrafts, setEventDrafts] = useState<
    Record<string, { time: string; title: string; detail: string }>
  >({});
  const [contractDrafts, setContractDrafts] = useState<
    Record<string, { team: string; count: string; description: string }>
  >({});

  const loadDashboard = async (options?: { preserveNotice?: boolean }) => {
    setError("");
    if (!options?.preserveNotice) {
      setNotice("");
    }

    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (response.status === 401) {
        setSessionUser(null);
        setDashboard(emptyDashboard);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load dashboard: ${response.status}`);
      }

      const data = (await response.json()) as DashboardPayload;
      setDashboard(data);
      setSelectedAgentId((current) =>
        current && data.agents.some((agent) => agent.id === current)
          ? current
          : (data.agents[0]?.id ?? "")
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown load error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        if (response.status === 401) {
          setSessionUser(null);
          setIsLoading(false);
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to load session: ${response.status}`);
        }

        const data = (await response.json()) as { user: { username: string } };
        setSessionUser(data.user.username);
        await loadDashboard();
      } catch (sessionError) {
        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "Unknown session error"
        );
        setIsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setTaskDrafts(
      Object.fromEntries(
        dashboard.tasks.map((task) => [
          task.id,
          { label: task.label, owner: task.owner, state: task.state },
        ])
      )
    );
    setEventDrafts(
      Object.fromEntries(
        dashboard.events.map((event) => [
          event.id,
          { time: event.time, title: event.title, detail: event.detail },
        ])
      )
    );
    setContractDrafts(
      Object.fromEntries(
        dashboard.contracts.map((contract) => [
          contract.id,
          {
            team: contract.team,
            count: contract.count,
            description: contract.description,
          },
        ])
      )
    );
  }, [dashboard]);

  const selectedAgent =
    dashboard.agents.find((agent) => agent.id === selectedAgentId) ??
    dashboard.agents[0];

  const filteredAgents = useMemo(() => {
    if (filter === "All") return dashboard.agents;
    return dashboard.agents.filter((agent) => agent.status === filter);
  }, [dashboard.agents, filter]);

  const missionMetrics = useMemo(() => {
    const hired = dashboard.agents.filter((agent) => agent.status === "Hired").length;
    const trial = dashboard.agents.filter((agent) => agent.status === "Trial").length;
    const live = dashboard.agents.filter((agent) => agent.mode === "Live").length;
    const spend = dashboard.agents.reduce((total, agent) => total + agent.spend, 0);

    return [
      {
        label: "Fleet coverage",
        value: `${dashboard.agents.length}`,
        meta: "agents indexed",
      },
      {
        label: "Currently hired",
        value: `${hired}`,
        meta: `${trial} in onboarding`,
      },
      {
        label: "Live automations",
        value: `${live * 12 + 100}`,
        meta: "active across 7 domains",
      },
      {
        label: "Monthly spend",
        value: `$${spend.toLocaleString()}`,
        meta: "tracked in real time",
      },
    ];
  }, [dashboard.agents]);

  const pipeline = useMemo(
    () => [
      {
        label: "Assigned",
        value:
          dashboard.agents.filter((agent) => agent.status !== "Available").length * 3,
      },
      {
        label: "Running",
        value: dashboard.agents.filter((agent) => agent.mode === "Live").length * 6,
      },
      {
        label: "Blocked",
        value: dashboard.tasks.filter((task) => task.state === "Blocked").length,
      },
      { label: "Completed today", value: 116 },
    ],
    [dashboard.agents, dashboard.tasks]
  );

  const mutateResource = async ({
    url,
    body,
    successMessage,
    failureLabel,
  }: {
    url: string;
    body: Record<string, unknown>;
    successMessage: string;
    failureLabel: string;
  }) => {
    setIsMutating(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status === 409) {
        await loadDashboard({ preserveNotice: true });
        setNotice(
          "Dashboard data changed before your update. The latest state has been loaded; retry the action if it still applies."
        );
        return;
      }

      if (response.status === 401) {
        setSessionUser(null);
        setDashboard(emptyDashboard);
        setNotice("");
        setError("Session expired. Sign in again.");
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to ${failureLabel}: ${response.status}`);
      }

      await loadDashboard({ preserveNotice: true });
      setNotice(successMessage);
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Unknown mutation error"
      );
    } finally {
      setIsMutating(false);
    }
  };

  const mutateAgent = async (agent: Agent, status: AgentStatus, mode: AgentMode) => {
    await mutateResource({
      url: `/api/agents/${encodeURIComponent(agent.id)}`,
      body: { status, mode, version: dashboard.version },
      successMessage: `${agent.name} updated successfully.`,
      failureLabel: `update ${agent.name}`,
    });
  };

  const signIn = async () => {
    setIsAuthenticating(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm),
      });

      if (!response.ok) {
        throw new Error(
          response.status === 401 ? "Invalid credentials." : `Sign-in failed: ${response.status}`
        );
      }

      const data = (await response.json()) as { user: { username: string } };
      setSessionUser(data.user.username);
      await loadDashboard({ preserveNotice: true });
      setNotice(`Signed in as ${data.user.username}.`);
      setAuthForm((current) => ({ ...current, password: "" }));
    } catch (signInError) {
      setError(
        signInError instanceof Error ? signInError.message : "Unknown sign-in error"
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  const signOut = async () => {
    setIsAuthenticating(true);
    setError("");
    setNotice("");

    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setSessionUser(null);
      setDashboard(emptyDashboard);
      setSelectedAgentId("");
      setNotice("Signed out.");
    } catch (signOutError) {
      setError(
        signOutError instanceof Error ? signOutError.message : "Unknown sign-out error"
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (!sessionUser) {
    return (
      <main className="min-h-screen">
        <section className="shell">
          <div className="backdrop-grid" />
          <section className="hero-panel auth-panel">
            <div className="hero-copy">
              <p className="eyebrow">Mission Control / Sign In</p>
              <h1>Secure the control surface.</h1>
              <p className="hero-text">
                Sign in to view and mutate the fleet. Configure
                `MISSION_CONTROL_USERNAME`, `MISSION_CONTROL_PASSWORD`, and
                `MISSION_CONTROL_SESSION_SECRET` for non-default credentials.
              </p>

              <div className="auth-form">
                <label className="field-label">
                  <span>Username</span>
                  <input
                    className="field-input"
                    value={authForm.username}
                    onChange={(event) =>
                      setAuthForm((current) => ({
                        ...current,
                        username: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field-label">
                  <span>Password</span>
                  <input
                    type="password"
                    className="field-input"
                    value={authForm.password}
                    onChange={(event) =>
                      setAuthForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={isAuthenticating || isLoading}
                    onClick={() => void signIn()}
                  >
                    Sign in
                  </button>
                </div>
                {error ? <p className="inline-notice">{error}</p> : null}
                {!error && notice ? <p className="inline-notice">{notice}</p> : null}
              </div>
            </div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <section className="shell">
        <div className="backdrop-grid" />

        <div className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Agent Registry / Mission Control</p>
            <h1>
              A single command surface for hiring, tracking, and governing your
              entire agent fleet.
            </h1>
            <p className="hero-text">
              Built as a calm operations layer: modern, minimal, and explicit
              about who is active, what they own, how they are performing, and
              where intervention is required.
            </p>

            <div className="hero-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={!selectedAgent || isMutating}
                onClick={() =>
                  selectedAgent && void mutateAgent(selectedAgent, "Hired", "Live")
                }
              >
                Hire selected agent
              </button>
              <button
                type="button"
                className="button"
                disabled={!selectedAgent || isMutating}
                onClick={() =>
                  selectedAgent && void mutateAgent(selectedAgent, "Paused", "Queued")
                }
              >
                Pause selected agent
              </button>
              <button
                type="button"
                className="button"
                disabled={isLoading}
                onClick={() => void loadDashboard()}
              >
                Refresh data
              </button>
              <button
                type="button"
                className="button"
                disabled={isAuthenticating}
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>

            <p className="session-note">Signed in as {sessionUser}</p>
            {error ? <p className="inline-notice">{error}</p> : null}
            {!error && notice ? <p className="inline-notice">{notice}</p> : null}
          </div>

          <div className="hero-orb">
            <div className="orb-ring orb-ring-a" />
            <div className="orb-ring orb-ring-b" />
            <div className="orb-core">
              <span>
                {dashboard.agents.filter((agent) => agent.status === "Hired").length}
              </span>
              <small>Hired agents</small>
            </div>
          </div>
        </div>

        <section className="metrics-grid">
          {missionMetrics.map((metric) => (
            <article key={metric.label} className="metric-card">
              <p>{metric.label}</p>
              <strong>{metric.value}</strong>
              <span>{metric.meta}</span>
            </article>
          ))}
        </section>

        <section className="dashboard-grid">
          <section className="panel panel-large">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Fleet visibility</p>
                <h2>Agent roster</h2>
              </div>
              <div className="filter-row">
                {(["All", "Hired", "Trial", "Available", "Paused"] as const).map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      className={`mini-pill${
                        filter === option ? " mini-pill-active" : ""
                      }`}
                      onClick={() => setFilter(option)}
                    >
                      {option}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="agent-list">
              {filteredAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`agent-card agent-card-button${
                    selectedAgentId === agent.id ? " agent-card-active" : ""
                  }`}
                  onClick={() => setSelectedAgentId(agent.id)}
                >
                  <div className="agent-identity">
                    <span className="agent-dot" style={{ background: agent.accent }} />
                    <div>
                      <h3>{agent.name}</h3>
                      <p>{agent.role}</p>
                    </div>
                  </div>

                  <div className="agent-badges">
                    <span className="status-badge">{agent.status}</span>
                    <span className="mode-badge">{agent.mode}</span>
                  </div>

                  <div className="agent-stats">
                    <div>
                      <span>Utilization</span>
                      <strong>{agent.utilization}%</strong>
                    </div>
                    <div>
                      <span>Latency</span>
                      <strong>{agent.latency}s</strong>
                    </div>
                    <div>
                      <span>Success</span>
                      <strong>{agent.successRate}%</strong>
                    </div>
                    <div>
                      <span>Spend</span>
                      <strong>${agent.spend}</strong>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="panel stack">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Runtime state</p>
                <h2>Workload pulse</h2>
              </div>
            </div>

            <div className="pulse-list">
              {pipeline.map((item) => (
                <div key={item.label} className="pulse-row">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>

            <div className="signal-card">
              <p>Primary directive</p>
              <strong>Keep hired agents above 95% successful completion.</strong>
              <span>
                {selectedAgent
                  ? `Selected agent: ${selectedAgent.name}. Current queue depth: ${selectedAgent.queueDepth}. Last active: ${selectedAgent.lastActive}.`
                  : "No agent selected."}
              </span>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Selected agent</p>
                <h2>
                  {selectedAgent ? `${selectedAgent.name} control panel` : "Awaiting data"}
                </h2>
              </div>
              <div className="pill">{selectedAgent?.owner ?? "Unassigned"}</div>
            </div>

            <div className="detail-stack">
              <div className="detail-card">
                <span>Current task</span>
                <strong>{selectedAgent?.currentTask ?? "Loading..."}</strong>
              </div>

              <div className="detail-grid">
                <div className="detail-card">
                  <span>Queue depth</span>
                  <strong>{selectedAgent?.queueDepth ?? "--"}</strong>
                </div>
                <div className="detail-card">
                  <span>Last active</span>
                  <strong>{selectedAgent?.lastActive ?? "--"}</strong>
                </div>
              </div>

              <div className="detail-grid">
                <div className="detail-card">
                  <span>Last updated by</span>
                  <strong>{selectedAgent?.updatedBy ?? "--"}</strong>
                </div>
                <div className="detail-card">
                  <span>Updated at</span>
                  <strong>{selectedAgent?.updatedAt ?? "--"}</strong>
                </div>
              </div>

              <div className="detail-card">
                <span>Permissions</span>
                <div className="token-row">
                  {selectedAgent?.permissions.map((permission) => (
                    <small key={permission} className="token">
                      {permission}
                    </small>
                  )) ?? <small className="token">loading</small>}
                </div>
              </div>

              <div className="detail-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!selectedAgent || isMutating}
                  onClick={() =>
                    selectedAgent && void mutateAgent(selectedAgent, "Hired", "Live")
                  }
                >
                  Set live
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={!selectedAgent || isMutating}
                  onClick={() =>
                    selectedAgent &&
                    void mutateAgent(selectedAgent, "Trial", "Learning")
                  }
                >
                  Retrain
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={!selectedAgent || isMutating}
                  onClick={() =>
                    selectedAgent &&
                    void mutateAgent(selectedAgent, "Available", "Standby")
                  }
                >
                  Release
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Recent activity</p>
                <h2>Event stream</h2>
              </div>
            </div>

            <div className="event-list">
              {dashboard.events.map((event) => (
                <article key={event.id} className="event-row">
                  <span>{event.time}</span>
                  <div className="inline-editor">
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                    <div className="field-grid">
                      <label className="field-label">
                        <span>Time</span>
                        <input
                          className="field-input"
                          value={eventDrafts[event.id]?.time ?? event.time}
                          onChange={(changeEvent) =>
                            setEventDrafts((current) => ({
                              ...current,
                              [event.id]: {
                                time: changeEvent.target.value,
                                title: current[event.id]?.title ?? event.title,
                                detail: current[event.id]?.detail ?? event.detail,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        <span>Title</span>
                        <input
                          className="field-input"
                          value={eventDrafts[event.id]?.title ?? event.title}
                          onChange={(changeEvent) =>
                            setEventDrafts((current) => ({
                              ...current,
                              [event.id]: {
                                time: current[event.id]?.time ?? event.time,
                                title: changeEvent.target.value,
                                detail: current[event.id]?.detail ?? event.detail,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label className="field-label">
                      <span>Detail</span>
                      <textarea
                        className="field-input field-textarea"
                        value={eventDrafts[event.id]?.detail ?? event.detail}
                        onChange={(changeEvent) =>
                          setEventDrafts((current) => ({
                            ...current,
                            [event.id]: {
                              time: current[event.id]?.time ?? event.time,
                              title: current[event.id]?.title ?? event.title,
                              detail: changeEvent.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <div className="row-actions">
                      <small className="audit-note">
                        Last updated by {event.updatedBy} at {event.updatedAt}
                      </small>
                      <button
                        type="button"
                        className="button"
                        disabled={isMutating}
                        onClick={() =>
                          void mutateResource({
                            url: `/api/events/${encodeURIComponent(event.id)}`,
                            body: {
                              ...eventDrafts[event.id],
                              version: dashboard.version,
                            },
                            successMessage: `${event.title} updated successfully.`,
                            failureLabel: `update ${event.title}`,
                          })
                        }
                      >
                        Save event
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Department contracts</p>
                <h2>Hiring map</h2>
              </div>
            </div>

            <div className="contract-list">
              {dashboard.contracts.map((contract) => (
                <article key={contract.id} className="contract-row">
                  <strong>{contract.count}</strong>
                  <div className="inline-editor">
                    <span>{contract.team}</span>
                    <p>{contract.description}</p>
                    <div className="field-grid">
                      <label className="field-label">
                        <span>Team</span>
                        <input
                          className="field-input"
                          value={contractDrafts[contract.id]?.team ?? contract.team}
                          onChange={(changeEvent) =>
                            setContractDrafts((current) => ({
                              ...current,
                              [contract.id]: {
                                team: changeEvent.target.value,
                                count: current[contract.id]?.count ?? contract.count,
                                description:
                                  current[contract.id]?.description ?? contract.description,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        <span>Count</span>
                        <input
                          className="field-input"
                          value={contractDrafts[contract.id]?.count ?? contract.count}
                          onChange={(changeEvent) =>
                            setContractDrafts((current) => ({
                              ...current,
                              [contract.id]: {
                                team: current[contract.id]?.team ?? contract.team,
                                count: changeEvent.target.value,
                                description:
                                  current[contract.id]?.description ?? contract.description,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label className="field-label">
                      <span>Description</span>
                      <textarea
                        className="field-input field-textarea"
                        value={
                          contractDrafts[contract.id]?.description ??
                          contract.description
                        }
                        onChange={(changeEvent) =>
                          setContractDrafts((current) => ({
                            ...current,
                            [contract.id]: {
                              team: current[contract.id]?.team ?? contract.team,
                              count: current[contract.id]?.count ?? contract.count,
                              description: changeEvent.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <div className="row-actions">
                      <small className="audit-note">
                        Last updated by {contract.updatedBy} at {contract.updatedAt}
                      </small>
                      <button
                        type="button"
                        className="button"
                        disabled={isMutating}
                        onClick={() =>
                          void mutateResource({
                            url: `/api/contracts/${encodeURIComponent(contract.id)}`,
                            body: {
                              ...contractDrafts[contract.id],
                              version: dashboard.version,
                            },
                            successMessage: `${contract.team} contract updated successfully.`,
                            failureLabel: `update ${contract.team} contract`,
                          })
                        }
                      >
                        Save contract
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Task queue</p>
                <h2>Operational handoffs</h2>
              </div>
            </div>

            <div className="task-list">
              {dashboard.tasks.map((task) => (
                <div key={task.id} className="task-row">
                  <div className="inline-editor">
                    <strong>{task.label}</strong>
                    <p>{task.owner}</p>
                    <div className="field-grid">
                      <label className="field-label">
                        <span>Task</span>
                        <input
                          className="field-input"
                          value={taskDrafts[task.id]?.label ?? task.label}
                          onChange={(changeEvent) =>
                            setTaskDrafts((current) => ({
                              ...current,
                              [task.id]: {
                                label: changeEvent.target.value,
                                owner: current[task.id]?.owner ?? task.owner,
                                state: current[task.id]?.state ?? task.state,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        <span>Owner</span>
                        <input
                          className="field-input"
                          value={taskDrafts[task.id]?.owner ?? task.owner}
                          onChange={(changeEvent) =>
                            setTaskDrafts((current) => ({
                              ...current,
                              [task.id]: {
                                label: current[task.id]?.label ?? task.label,
                                owner: changeEvent.target.value,
                                state: current[task.id]?.state ?? task.state,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="row-actions">
                      <small className="audit-note">
                        Last updated by {task.updatedBy} at {task.updatedAt}
                      </small>
                      <select
                        className="field-input field-select"
                        value={taskDrafts[task.id]?.state ?? task.state}
                        onChange={(changeEvent) =>
                          setTaskDrafts((current) => ({
                            ...current,
                            [task.id]: {
                              label: current[task.id]?.label ?? task.label,
                              owner: current[task.id]?.owner ?? task.owner,
                              state: changeEvent.target.value as TaskState,
                            },
                          }))
                        }
                      >
                        {taskStateOrder.map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="button"
                        disabled={isMutating}
                        onClick={() =>
                          void mutateResource({
                            url: `/api/tasks/${encodeURIComponent(task.id)}`,
                            body: {
                              ...taskDrafts[task.id],
                              version: dashboard.version,
                            },
                            successMessage: `${task.label} updated successfully.`,
                            failureLabel: `update ${task.label}`,
                          })
                        }
                      >
                        Save task
                      </button>
                    </div>
                  </div>
                  <span className="mode-badge">
                    {taskDrafts[task.id]?.state ?? task.state}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
