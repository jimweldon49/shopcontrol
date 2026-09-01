const jwt = require("jsonwebtoken");

const ROLE_PERMISSIONS = {
  admin: { resources: ["*"], actions: ["*"] },
  owner: { resources: ["*"], actions: ["*"] },
  manager: { resources: ["*"], actions: ["list", "create", "update", "delete", "upload"] },

  office: {
    resources: ["daily", "tasks", "facility", "ar", "activity", "uploads"],
    actions: ["list", "create", "update", "upload"],
    readOnlyResources: ["parts", "qc", "booth"],
  },
  estimator: {
    resources: ["daily", "tasks", "qc", "activity", "uploads"],
    actions: ["list", "create", "update", "upload"],
  },
  parts: {
    resources: ["daily", "tasks", "parts", "activity", "uploads"],
    actions: ["list", "create", "update", "upload"],
  },
  paint: {
    resources: ["daily", "tasks", "booth", "qc", "activity", "uploads"],
    actions: ["list", "create", "update", "upload"],
  },
  body: {
    resources: ["daily", "tasks", "qc", "activity", "uploads"],
    actions: ["list", "create", "update", "upload"],
  },
  qc: {
    resources: ["daily", "tasks", "qc", "activity", "uploads"],
    actions: ["list", "create", "update", "upload"],
  },
  cleanup: {
    resources: ["tasks", "facility", "booth", "activity", "uploads"],
    actions: ["list", "create", "update", "upload"],
  },
  employee: {
    resources: ["daily", "tasks", "parts", "qc", "booth", "facility", "activity", "uploads"],
    actions: ["list", "create", "update", "upload"],
  },
};

function normalizeRole(role) {
  return String(role || "employee").toLowerCase();
}

function hasPermission(user, resource, action) {
  const role = normalizeRole(user && user.role);
  const config = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.employee;
  const resources = config.resources || [];
  const actions = config.actions || [];
  const readOnlyResources = config.readOnlyResources || [];

  if (resources.includes("*") || resources.includes(resource)) {
    if (action === "delete") return user && user.canDelete !== false;
    return actions.includes("*") || actions.includes(action);
  }

  return readOnlyResources.includes(resource) && action === "list";
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing login token. Please log in again." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, fullName, role, canDelete }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Your session has expired. Please log in again." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !["admin", "owner"].includes(normalizeRole(req.user.role))) {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

function requireCanDelete(req, res, next) {
  if (!req.user || req.user.canDelete === false) {
    return res.status(403).json({ error: "Your account is not allowed to delete records." });
  }
  next();
}

function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Missing login token. Please log in again." });
    if (!hasPermission(req.user, resource, action)) {
      return res.status(403).json({ error: `You do not have permission to ${action} ${resource}.` });
    }
    next();
  };
}

module.exports = { requireAuth, requireAdmin, requireCanDelete, requirePermission, hasPermission, ROLE_PERMISSIONS };
