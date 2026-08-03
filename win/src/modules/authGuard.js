const { AuthError } = require('../errors');

const ACCESS_PUBLIC = 'public';
const ACCESS_SESSION = 'session';
const ACCESS_PROTECTED = 'protected';

const ALL_ROLES = ['ADM', 'USER'];
const ADMIN_ONLY = ['ADM'];

// Cada regra é avaliada em ordem; a primeira que casar define o requisito da rota.
const ROUTE_POLICIES = [
  { match: (p) => p === '/', access: ACCESS_PUBLIC },
  { match: (p) => p.startsWith('/css/') || p.startsWith('/js/'), access: ACCESS_PUBLIC },
  { match: (p) => p === '/api/v1/auth/login', access: ACCESS_PUBLIC },
  { match: (p) => p === '/api/v1/auth/refresh', access: ACCESS_PUBLIC },

  {
    match: (p) => /^\/api\/v1\/auth\/users\/[^/]+\/subscription$/.test(p),
    access: ACCESS_PROTECTED,
    roles: ADMIN_ONLY,
  },
  { match: (p) => p === '/api/v1/auth/users', access: ACCESS_PROTECTED, roles: ADMIN_ONLY },
  { match: (p) => p.startsWith('/api/v1/auth/'), access: ACCESS_SESSION },

  {
    match: (p) => p === '/api/v1/llm/process',
    access: ACCESS_PROTECTED,
    roles: ALL_ROLES,
    elevation: true,
    subscription: true,
  },
  {
    match: (p) => p.startsWith('/api/v1/llm/'),
    access: ACCESS_PROTECTED,
    roles: ALL_ROLES,
    subscription: true,
  },
  { match: (p) => p.startsWith('/api/v1/logs'), access: ACCESS_PROTECTED, roles: ADMIN_ONLY },

  {
    match: (p) => p.startsWith('/api/v1/files'),
    access: ACCESS_PROTECTED,
    roles: ALL_ROLES,
    elevation: true,
    subscription: true,
  },
  {
    match: (p) => p.startsWith('/api/v1/fs/'),
    access: ACCESS_PROTECTED,
    roles: ALL_ROLES,
    elevation: true,
    subscription: true,
  },
  {
    match: (p) => p.startsWith('/api/v1/pipeline/'),
    access: ACCESS_PROTECTED,
    roles: ALL_ROLES,
    elevation: true,
    subscription: true,
  },
  {
    match: (p) => p.startsWith('/api/v1/input/'),
    access: ACCESS_PROTECTED,
    roles: ALL_ROLES,
    elevation: true,
    subscription: true,
  },
  {
    match: (p) => p.startsWith('/api/v1/spreadsheet/'),
    access: ACCESS_PROTECTED,
    roles: ALL_ROLES,
    elevation: true,
    subscription: true,
  },
  {
    match: (p) => p.startsWith('/open/'),
    access: ACCESS_PROTECTED,
    roles: ALL_ROLES,
    elevation: true,
    subscription: true,
  },
];

const DEFAULT_POLICY = { access: ACCESS_SESSION };

function resolveRoutePolicy(pathname) {
  const rule = ROUTE_POLICIES.find((policy) => policy.match(pathname));
  if (!rule) {
    return DEFAULT_POLICY;
  }
  return {
    access: rule.access,
    roles: rule.roles,
    elevation: Boolean(rule.elevation),
    subscription: Boolean(rule.subscription),
  };
}

function extractAccessToken(req, url, pathname) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }
  if (pathname.startsWith('/open/')) {
    return url.searchParams.get('access_token');
  }
  return null;
}

function extractElevationToken(req, url, pathname) {
  const header = req.headers['x-elevation-token'];
  if (header) {
    return header;
  }
  if (pathname.startsWith('/open/')) {
    return url.searchParams.get('elevation_token');
  }
  return null;
}

function createAuthGuard({ authService }) {
  return {
    // → { userId, username, role } ou lança AuthError 401/403.
    async enforce(req, url, pathname) {
      const policy = resolveRoutePolicy(pathname);
      if (policy.access === ACCESS_PUBLIC) {
        return null;
      }

      const accessToken = extractAccessToken(req, url, pathname);
      if (!accessToken) {
        throw new AuthError('Authentication required', { code: 'AUTH_REQUIRED' });
      }

      const claims = authService.verifyAccessToken(accessToken);
      const auth = { userId: claims.sub, username: claims.username, role: claims.role };

      if (policy.roles && !policy.roles.includes(auth.role)) {
        throw new AuthError('Your role does not allow this operation', {
          statusCode: 403,
          code: 'FORBIDDEN_ROLE',
        });
      }

      if (policy.subscription || policy.elevation) {
        const user = await authService.getUser(auth.userId);
        if (policy.subscription) {
          authService.requireActiveSubscription(user);
        }
      }

      if (policy.elevation) {
        const elevationToken = extractElevationToken(req, url, pathname);
        if (!elevationToken) {
          throw new AuthError('TOTP elevation required for file operations', {
            statusCode: 403,
            code: 'ELEVATION_REQUIRED',
          });
        }
        try {
          authService.verifyElevationToken(elevationToken, auth.userId);
        } catch {
          throw new AuthError('TOTP elevation expired or invalid', {
            statusCode: 403,
            code: 'ELEVATION_REQUIRED',
          });
        }
      }

      return auth;
    },
  };
}

module.exports = {
  resolveRoutePolicy,
  createAuthGuard,
};
