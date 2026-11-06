/**
 * CPI tenant client - lists Security Material (User Credentials, OAuth2
 * Client Credentials, Keystore entries) so the UI can offer real names
 * instead of the AI inventing them.
 *
 * Uses the Cloud Integration OData API (/api/v1/...) with OAuth2 client
 * credentials from an "it-rt" (plan "api") service key -- the same
 * resolution order as cpi-ai-deployer:
 *   1. VCAP_SERVICES binding (instance "cpi-ai-platform-api" or label "it-rt")
 *   2. CPI_CLIENT_ID / CPI_CLIENT_SECRET / CPI_TOKEN_URL / CPI_API_BASE_URL
 *
 * The service key's role collection must include reading security
 * material, otherwise the tenant answers 403.
 */

const axios = require("axios");

/** RequiredInput kind -> Security Content entity set + how to read each entry. */
const SECURITY_MATERIAL = {
  UserCredential: {
    entitySet: "UserCredentials",
    toItem: (e) => ({ name: e.Name, description: e.Description || e.Kind || "" })
  },
  OAuth2ClientCredential: {
    entitySet: "OAuth2ClientCredentials",
    toItem: (e) => ({ name: e.Name, description: e.Description || e.TokenServiceUrl || "" })
  },
  KeystoreAlias: {
    entitySet: "KeystoreEntries",
    toItem: (e) => ({ name: e.Alias, description: e.Type || e.Owner || "" })
  }
};

function resolveCredentials() {
  if (process.env.VCAP_SERVICES) {
    try {
      const instances = Object.values(JSON.parse(process.env.VCAP_SERVICES)).flat();
      const instance = instances.find(
        (i) => i && (i.name === "cpi-ai-platform-api" || i.label === "it-rt")
      );
      const c = instance && (instance.credentials?.oauth || instance.credentials);
      if (c?.clientid && c?.clientsecret && c?.tokenurl && c?.url) {
        return { clientId: c.clientid, clientSecret: c.clientsecret, tokenUrl: c.tokenurl, apiBaseUrl: c.url };
      }
    } catch {
      // fall through to env vars
    }
  }

  const { CPI_CLIENT_ID, CPI_CLIENT_SECRET, CPI_TOKEN_URL, CPI_API_BASE_URL } = process.env;
  if (CPI_CLIENT_ID && CPI_CLIENT_SECRET && CPI_TOKEN_URL && CPI_API_BASE_URL) {
    return { clientId: CPI_CLIENT_ID, clientSecret: CPI_CLIENT_SECRET, tokenUrl: CPI_TOKEN_URL, apiBaseUrl: CPI_API_BASE_URL };
  }
  return null;
}

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken(creds) {
  if (cachedToken && Date.now() < cachedTokenExpiry - 30000) {
    return cachedToken;
  }
  const response = await axios.post(
    creds.tokenUrl,
    new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    {
      auth: { username: creds.clientId, password: creds.clientSecret },
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }
  );
  cachedToken = response.data.access_token;
  cachedTokenExpiry = Date.now() + response.data.expires_in * 1000;
  return cachedToken;
}

/** True when tenant API credentials are configured. */
function isTenantConfigured() {
  return resolveCredentials() !== null;
}

/**
 * Lists security material of one kind from the tenant.
 *
 * @param {"UserCredential"|"OAuth2ClientCredential"|"KeystoreAlias"} kind
 * @returns {Promise<Array<{ name: string, description: string }>>}
 */
async function listSecurityMaterial(kind) {
  const spec = SECURITY_MATERIAL[kind];
  if (!spec) {
    throw new Error(`No security material lookup for kind "${kind}"`);
  }
  const creds = resolveCredentials();
  if (!creds) {
    throw new Error(
      "CPI tenant API is not configured. Bind an it-rt (plan api) service instance, " +
      "or set CPI_CLIENT_ID / CPI_CLIENT_SECRET / CPI_TOKEN_URL / CPI_API_BASE_URL."
    );
  }

  const token = await getAccessToken(creds);
  const response = await axios.get(
    `${creds.apiBaseUrl}/api/v1/${spec.entitySet}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
  );
  const entries = response.data?.d?.results || response.data?.value || [];
  return entries
    .map(spec.toItem)
    .filter((item) => item.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------
// Creating security material (writes)
//
// Needs a service key whose role collection allows WRITING security
// material (a different permission from the read-only listing above).
// Same CSRF handshake CpiDeployer uses for its POSTs.
// ----------------------------------------------------------------

function requireCreds() {
  const creds = resolveCredentials();
  if (!creds) {
    throw new Error(
      "CPI tenant API is not configured. Bind an it-rt (plan api) service instance, " +
      "or set CPI_CLIENT_ID / CPI_CLIENT_SECRET / CPI_TOKEN_URL / CPI_API_BASE_URL."
    );
  }
  return creds;
}

async function writeHeaders(creds) {
  const token = await getAccessToken(creds);
  const handshake = await axios.get(`${creds.apiBaseUrl}/api/v1/UserCredentials`, {
    headers: { Authorization: `Bearer ${token}`, "X-CSRF-Token": "Fetch", Accept: "application/json" }
  });
  return {
    Authorization: `Bearer ${token}`,
    "X-CSRF-Token": handshake.headers["x-csrf-token"],
    Cookie: handshake.headers["set-cookie"],
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

/** Readable message for a failed create/update; never includes the password. */
function describeWriteError(error, name) {
  const status = error.response?.status;
  if (status === 401 || status === 403) {
    return "The CPI API service key is not allowed to create security material. " +
      "Add the role that grants write access to security material (e.g. WorkspaceArtifactsWrite / security content write) and try again.";
  }
  if (status === 409) {
    return `A credential named "${name}" already exists on the tenant.`;
  }
  const detail = error.response?.data?.error?.message?.value || error.response?.data?.error?.message;
  return `Creating "${name}" failed${status ? ` (HTTP ${status})` : ""}${detail ? `: ${detail}` : `: ${error.message}`}`;
}

/** True when a User Credential with this name exists on the tenant. */
async function userCredentialExists(name) {
  const all = await listSecurityMaterial("UserCredential");
  return all.some((m) => m.name === name);
}

/**
 * Creates a User Credential (Basic auth).
 * @param {{ name: string, user: string, password: string, description?: string }} material
 */
async function createUserCredential({ name, user, password, description }) {
  const creds = requireCreds();
  try {
    await axios.post(
      `${creds.apiBaseUrl}/api/v1/UserCredentials`,
      { Name: name, Kind: "default", Description: description || "", User: user, Password: password, CompanyId: "" },
      { headers: await writeHeaders(creds) }
    );
  } catch (error) {
    throw new Error(describeWriteError(error, name));
  }
}

/**
 * Overwrites an existing User Credential's user/password.
 * @param {{ name: string, user: string, password: string, description?: string }} material
 */
async function updateUserCredential({ name, user, password, description }) {
  const creds = requireCreds();
  try {
    await axios.put(
      `${creds.apiBaseUrl}/api/v1/UserCredentials('${encodeURIComponent(name)}')`,
      { Name: name, Kind: "default", Description: description || "", User: user, Password: password, CompanyId: "" },
      { headers: await writeHeaders(creds) }
    );
  } catch (error) {
    throw new Error(describeWriteError(error, name));
  }
}

module.exports = {
  SECURITY_MATERIAL_KINDS: Object.keys(SECURITY_MATERIAL),
  isTenantConfigured,
  listSecurityMaterial,
  userCredentialExists,
  createUserCredential,
  updateUserCredential
};
