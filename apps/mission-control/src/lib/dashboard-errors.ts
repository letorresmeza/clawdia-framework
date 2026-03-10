export class DashboardVersionConflictError extends Error {
  constructor(message = "dashboard version conflict") {
    super(message);
    this.name = "DashboardVersionConflictError";
  }
}
