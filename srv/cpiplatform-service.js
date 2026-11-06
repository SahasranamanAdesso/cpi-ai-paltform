const cds = require("@sap/cds");
const axios = require("axios");
const { Readable } = require("stream");
const fs = require("fs");
const path = require("path");

const {
  fromJson,
  validate,
  compileToZip,
  getRequiredInputs,
  applyInputs,
  withDraftPlaceholders
} = require("@cpi-ai/compiler");

const tenant = require("./cpi-tenant");
const { CpiDeployer } = require("@david10ten/deployer");

module.exports = cds.service.impl(function () {

  // ============================================================
  // COMPILER CAPABILITIES
  // ============================================================

  function getCompilerCapabilities() {

    try {

      const compiler =
        require("@cpi-ai/compiler");

      if (
        typeof compiler.getCapabilities === "function"
      ) {
        return compiler.getCapabilities();
      }

      /*
       * Fallback contract.
       * The compiler remains the final authority.
       */
      return {
        format: "IFlowJson",

        adapters: [
          "HTTP",
          "HTTPS",
          "OData",
          "SFTP",
          "SOAP",
          "IDoc"
        ],

        components: [
          "ContentModifier",
          "Router",
          "GroovyScript",
          "DataStore",
          "Multicast",
          "Splitter",
          "Gather",
          "MessageMapping",
          "XmlValidator",
          "XsltMapping",
          "ProcessCall"
        ],

        resources: {
          type: [
            "groovy",
            "mapping",
            "xsd",
            "xslt"
          ],
          schema: {
            type: "string",
            name: "string",
            content: "string"
          },
          required: [
            "type",
            "name",
            "content"
          ]
        },

        rules: {
          unknownTypes: "forbidden",
          inventedTypes: "forbidden",
          inventedProperties: "forbidden",
          sender: "top-level sender object",
          receiver: "top-level receiver object",
          connections:
            "reference sender, receiver, or component ids"
        }
      };

    } catch (error) {

      console.error(
        "Unable to discover compiler capabilities:",
        error
      );

      throw new Error(
        "Compiler capability discovery failed"
      );
    }
  }


  // ============================================================
  // SYSTEM PROMPT
  // ============================================================

  function buildSystemPrompt() {

    const capabilities =
      getCompilerCapabilities();

    return `
You are the AI translation layer for an SAP Integration Suite
iFlow compiler.

Translate the user's natural-language request into the exact
GENERIC JSON CONTRACT accepted by the compiler.

The compiler capabilities below are the AUTHORITATIVE source
of truth.

${JSON.stringify(capabilities, null, 2)}

IMPORTANT OUTPUT RULES

1. Return ONLY valid JSON.

2. Do not return Markdown.

3. Do not return code fences.

4. Do not explain the answer.

5. Use ONLY adapter types present in the compiler capabilities.

6. Use ONLY component types present in the compiler capabilities.

7. Use ONLY configuration properties supported by the compiler.

8. NEVER invent component types.

9. NEVER invent adapter types.

10. NEVER invent configuration properties.

11. NEVER convert a natural-language CPI concept into an
    invented compiler component.

12. Do not use implementation-specific SAP names unless they
    are explicitly present in the capabilities.

13. NEVER invent unsupported types such as:
    ScriptCollection
    CustomScript
    CustomAdapter
    UnknownComponent
    or any other unsupported type.

14. The generated JSON must be directly consumable by
    fromJson().

15. Preserve the user's requested component names as component
    configuration/name values where supported, but use valid
    generic compiler component types and schemas.

16. Do not create a component simply because a natural-language
    concept sounds like a CPI component. Use only types supported
    by the compiler.

17. If a requested capability cannot be represented by the
    compiler contract, do not invent a schema for it.


GENERIC IFLOW JSON STRUCTURE

{
  "name": "FlowName",

  "sender": {
    "type": "SUPPORTED_ADAPTER",
    "config": {}
  },

  "components": [
    {
      "id": "component1",
      "type": "SUPPORTED_COMPONENT",
      "config": {}
    }
  ],

  "receiver": {
    "type": "SUPPORTED_ADAPTER",
    "config": {}
  },

  "connections": [],

  "resources": []
}


SENDER AND RECEIVER

sender and receiver are top-level properties.

Do NOT create components named:

sender
receiver

Connections may reference:

sender
receiver

or actual component IDs.


CONNECTION RULES

Every requested component that participates in the message flow
must have the required explicit connections.

Connection format:

{
  "from": "componentId",
  "to": "componentId"
}

The special connection endpoints may be:

"sender"
"receiver"

All other connection endpoints must be actual component IDs.

Every connection target must actually exist.

Do not invent IDs.

Do not create connections to nonexistent components.


TYPICAL FLOW

sender
↓
component1
↓
component2
↓
receiver


ROUTER RULES

Router routes and connections MUST correspond.

Example structure:

{
  "id": "router1",
  "type": "Router",
  "config": {
    "routes": [
      {
        "condition": "\\\${header.Country} == 'IN'",
        "target": "groovy1"
      },
      {
        "condition": "\\\${header.Country} != 'IN'",
        "target": "receiver"
      }
    ]
  }
}

The corresponding connections must contain:

{
  "from": "router1",
  "to": "groovy1"
}

and:

{
  "from": "router1",
  "to": "receiver"
}

Never create a Router route without its corresponding
connection.

Router route targets must be either valid component IDs or valid
flow endpoints supported by the compiler contract.


GROOVY SCRIPT RULES

Use ONLY the GroovyScript schema exposed by the compiler.

Do NOT invent ScriptCollection.

Do NOT invent custom script properties.

If the compiler requires scriptName, provide scriptName.

When a Groovy resource is required, reference the resource using
the compiler-supported GroovyScript configuration.


RESOURCE RULES

Resources MUST be an array of OBJECTS.

Resources MUST NOT be an array of strings.

Every resource object MUST contain:

- type
- name
- content

Generic resource structure:

{
  "type": "groovy",
  "name": "transform.groovy",
  "content": "full resource content"
}

The supported resource type MUST come from the compiler
capabilities.

Do NOT invent resource types.

Do NOT generate:

"resources": [
  "groovy"
]

Do NOT generate:

"resources": [
  "transform.groovy"
]

Do NOT generate resource objects missing required fields.

Correct generic structure:

"resources": [
  {
    "type": "groovy",
    "name": "transform.groovy",
    "content": "def Message processData(Message message) { return message; }"
  }
]

For every requested resource, provide its complete content as
a string.

Do not use external filenames without the required resource
object.

Do not omit content.

RESOURCE PATH RULES

The resource packager automatically places resources into the
appropriate compiler resource directory based on their "type".

Therefore the resource "name" MUST be a filename or relative
filename only.

NEVER include the resource type directory in the name.

For XSD:

CORRECT:
{
    "type": "xsd",
    "name": "DomesticOrder.xsd",
    "content": "..."
}

INCORRECT:
{
    "type": "xsd",
    "name": "/xsd/DomesticOrder.xsd",
    "content": "..."
}

INCORRECT:
{
    "type": "xsd",
    "name": "xsd/DomesticOrder.xsd",
    "content": "..."
}

For Groovy:

CORRECT:
{
    "type": "groovy",
    "name": "transform.groovy",
    "content": "..."
}

INCORRECT:
{
    "type": "groovy",
    "name": "/groovy/transform.groovy",
    "content": "..."
}

For mapping:

CORRECT:
{
    "type": "mapping",
    "name": "OrderMapping.mmap",
    "content": "..."
}

For XSLT:

CORRECT:
{
    "type": "xslt",
    "name": "transform.xslt",
    "content": "..."
}

The compiler/packager is responsible for adding the appropriate
resource directory.

Never prefix resource names with:
"/xsd/"
"xsd/"
"/groovy/"
"groovy/"
"/mapping/"
"mapping/"
"/xslt/"
"xslt/"

Resource names must not begin with "/".

Resource names must not contain the resource type directory.

CONTENT MODIFIER RULES

Use the compiler's canonical ContentModifier structure.

For example, when supported:

{
  "id": "cm1",
  "type": "ContentModifier",
  "config": {
    "headers": [
      {
        "name": "Country",
        "value": "IN"
      }
    ]
  }
}

Do not invent alternative property names when they are not
supported by the compiler.

PROCESSCALL RULES

ProcessCall is a compiler-supported component type.

IMPORTANT:

Do not create multiple ProcessCall components in the same
iFlow unless the compiler capabilities explicitly indicate
that multiple ProcessCall instances are supported.

If the requested scenario requires multiple independent
processing services and multiple ProcessCall instances cause
compiler validation errors, use supported adapter/component
types that can represent the requested processing services.

Never create duplicate internal compiler component instances.

Component IDs in the generated JSON MUST be unique.

Before returning the JSON, check that no two components have
the same id.

For example, this is valid at the JSON level:

{
    "id": "domesticService",
    "type": "ProcessCall"
}

{
    "id": "internationalService",
    "type": "ProcessCall"
}

However, if the compiler rejects multiple ProcessCall
instances, do not repeatedly regenerate the same structure.
Use an alternative supported representation.

URL RULES

URLs MUST be plain strings.

If the user provides a Markdown URL, extract only the actual URL.

For example:

Correct:

"https://example.com/orders"

Incorrect:

"[https://example.com/orders](https://example.com/orders)"

Do not preserve Markdown link syntax inside JSON string values.


FINAL VALIDATION RULES

Before returning JSON, verify:

- The JSON is syntactically valid.
- All adapter types are supported.
- All component types are supported.
- All configuration properties are supported.
- All resource objects have type, name, and content.
- All component IDs are unique.
- All connection endpoints exist.
- Every requested component is connected appropriately.
- Router targets correspond to actual components or valid flow
  endpoints.
- No unsupported component types are invented.
- No unsupported resource types are invented.
- No ScriptCollection is invented.
- No Markdown URLs remain.
- The result can be consumed directly by fromJson().

Return ONLY the complete compiler JSON.
`;
  }


  // ============================================================
  // AI HUB CONFIGURATION
  //
  // Two model slots: the primary model is always tried first,
  // the secondary model (with its own API key) is used when the
  // primary request fails.
  //
  // Locally the values are edited in the Settings dialog of
  // iFlow Studio and stored in .env (git-ignored).
  // On BTP they come from the app's environment variables.
  // ============================================================

  const DEFAULT_AI_HUB_URL =
    "https://adesso-ai-hub.3asabc.de/v1";

  // Offered in the model dropdown. Any other name can be typed in.
  const AVAILABLE_MODELS = [
    "gemma-4-26b-sovereign",
    "deepseek-v4-flash-sovereign",
    "qwen-3.6-35b-sovereign",
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-haiku-4-5",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5.5",
    "gpt-4.1",
    "gpt-4o",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "llama-3-3-70b",
    "qwen3-235b"
  ];

  const SLOTS = {
    primary: {
      prefix: "AI_HUB",
      label: "Primary",
      defaultModel: "gemma-4-26b-sovereign"
    },
    secondary: {
      prefix: "AI_HUB_SECONDARY",
      label: "Secondary",
      defaultModel: "claude-sonnet-4-6"
    }
  };

  const ENV_FILE =
    path.join(cds.root, ".env");

  // Writing .env from the browser is a local-development
  // convenience only. In production the dialog is read-only.
  const CAN_SAVE_SETUP =
    process.env.NODE_ENV !== "production" &&
    !cds.env.profiles?.includes("production");

  // Result of the last real AI request, shown in the header
  const lastCall = {
    model: null,
    slot: null,
    at: null,
    fallbackReason: null
  };

  function normalizeUrl(url) {
    return (url || "").trim().replace(/\/+$/, "");
  }

  function readSlot(slot) {

    const { prefix, defaultModel } = SLOTS[slot];

    return {
      slot,
      label: SLOTS[slot].label,
      apiKey: process.env[`${prefix}_API_KEY`] || "",
      url:
        normalizeUrl(process.env[`${prefix}_URL`]) ||
        DEFAULT_AI_HUB_URL,
      model:
        process.env[`${prefix}_MODEL`] ||
        defaultModel
    };
  }

  // Configured slots in the order they should be tried
  function getAiHubConfigs() {

    const configs =
      ["primary", "secondary"]
        .map(readSlot)
        .filter((c) => c.apiKey);

    if (!configs.length) {
      throw new Error(
        "AI Hub is not configured yet. Click the gear icon at " +
        "the top right of iFlow Studio and enter an API key."
      );
    }

    return configs;
  }

  function maskKey(key) {

    if (!key) {
      return "";
    }

    if (key.length <= 8) {
      return "*".repeat(key.length);
    }

    return `${key.slice(0, 3)}******${key.slice(-4)}`;
  }

  // CPI tenant (Process Integration Runtime service key, plan "api")
  function readCpi() {
    return {
      clientId: process.env.CPI_CLIENT_ID || "",
      clientSecret: process.env.CPI_CLIENT_SECRET || "",
      tokenUrl: process.env.CPI_TOKEN_URL || "",
      apiBaseUrl: process.env.CPI_API_BASE_URL || "",
      packageId: process.env.CPI_PACKAGE_ID || "cpipackage"
    };
  }

  function cpiStatus() {

    const c = readCpi();

    let configured = false;

    try {
      // Also true when an it-rt service is bound on BTP
      require("@david10ten/deployer").resolveCredentials();
      configured = true;
    } catch (e) {
      configured = false;
    }

    return {
      configured,
      clientId: c.clientId,
      secretHint: maskKey(c.clientSecret),
      tokenUrl: c.tokenUrl,
      apiBaseUrl: c.apiBaseUrl,
      packageId: c.packageId
    };
  }

  // Empty secret means "keep the current one"
  function resolveCpiInput(data = {}) {

    const current = readCpi();
    const trim = (v) => (v || "").trim();

    return {
      clientId: trim(data.clientId),
      clientSecret: trim(data.clientSecret) || current.clientSecret,
      tokenUrl: trim(data.tokenUrl),
      apiBaseUrl: normalizeUrl(data.apiBaseUrl),
      packageId: trim(data.packageId) || "cpipackage"
    };
  }

  // Fetches an OAuth token and lists packages: checks the token
  // URL, the client credentials and the API base URL
  async function testCpi(cpi) {

    const missing = [
      ["clientId", "Client ID"],
      ["clientSecret", "Client secret"],
      ["tokenUrl", "Token URL"],
      ["apiBaseUrl", "API base URL"]
    ].filter(([k]) => !cpi[k]).map(([, label]) => label);

    if (missing.length) {
      return {
        slot: "cpi",
        ok: false,
        message: `Missing: ${missing.join(", ")}.`
      };
    }

    try {

      const deployer = new CpiDeployer({ credentials: cpi });
      const token = await deployer.getAccessToken();

      await axios.get(
        `${cpi.apiBaseUrl}/api/v1/IntegrationPackages('${encodeURIComponent(cpi.packageId)}')`,
        {
          timeout: 20000,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
        }
      ).catch((error) => {
        if (error.response?.status === 404) {
          throw Object.assign(
            new Error(`Connected, but package "${cpi.packageId}" does not exist on the tenant.`),
            { packageMissing: true }
          );
        }
        throw error;
      });

      return {
        slot: "cpi",
        ok: true,
        message: `Connected. Package "${cpi.packageId}" found.`
      };

    } catch (error) {

      if (error.packageMissing) {
        return { slot: "cpi", ok: false, message: error.message };
      }

      const isTokenCall =
        error.config?.url === cpi.tokenUrl;

      if (isTokenCall && error.response?.status === 401) {
        return {
          slot: "cpi",
          ok: false,
          message: "Client ID or secret was rejected by the token URL."
        };
      }

      return {
        slot: "cpi",
        ok: false,
        message:
          (isTokenCall ? "Token request failed: " : "") +
          (error.response ? describeCpiError(error) : `Could not reach ${error.config?.url || "the tenant"} (${error.code || error.message}).`)
      };
    }
  }

  function getSetupStatus() {

    const slotStatus = (slot) => {
      const c = readSlot(slot);
      return {
        configured: !!c.apiKey,
        url: c.url,
        model: c.model,
        keyHint: maskKey(c.apiKey)
      };
    };

    const primary = slotStatus("primary");
    const secondary = slotStatus("secondary");

    return {
      configured: primary.configured || secondary.configured,
      canSave: CAN_SAVE_SETUP,
      envFile: ENV_FILE,
      models: AVAILABLE_MODELS,
      primary,
      secondary,
      cpi: cpiStatus(),
      lastModel: lastCall.model,
      lastSlot: lastCall.slot,
      lastAt: lastCall.at,
      lastFallbackReason: lastCall.fallbackReason
    };
  }

  function describeAiError(error) {

    const status =
      error.response?.status;

    const detail =
      error.response?.data?.error?.message ||
      error.message;

    if (status === 401) {
      return "API key was rejected. Check that it is correct and still valid.";
    }

    // 403 also means "model not allowed for this key", so pass
    // the AI Hub's own explanation through
    if (status === 403) {
      return `Access denied: ${detail}`;
    }

    if (status === 404) {
      return `URL or model not found (${detail}).`;
    }

    if (status) {
      return `AI Hub answered with HTTP ${status}: ${detail}`;
    }

    return "AI Hub could not be reached. Check the URL and your " +
      `network or VPN (${error.code || detail}).`;
  }

  function postChat(config, body, timeout) {

    return axios.post(
      `${config.url}/chat/completions`,
      Object.assign({ model: config.model }, body),
      {
        timeout,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );
  }

  // Calls the primary model and falls back to the secondary one
  async function callAiWithFallback(body) {

    const configs = getAiHubConfigs();
    const failures = [];

    for (const config of configs) {

      try {

        console.log(
          `AI request -> ${config.label} model "${config.model}"`
        );

        const response =
          await postChat(config, body, 180000);

        lastCall.model = config.model;
        lastCall.slot = config.slot;
        lastCall.at = new Date().toISOString();
        lastCall.fallbackReason =
          failures.length ? failures.join(" | ") : null;

        return response;

      } catch (error) {

        const reason =
          `${config.label} (${config.model}): ${describeAiError(error)}`;

        console.error(
          "AI request failed:",
          reason,
          error.response?.data || ""
        );

        failures.push(reason);
      }
    }

    throw new Error(
      failures.length > 1
        ? `Both AI models failed. ${failures.join(" ")}`
        : `AI request failed. ${failures[0]}`
    );
  }

  // Resolves one slot from the dialog. An empty key means
  // "keep the key that is already configured".
  function resolveSlotInput(slot, data = {}) {

    const current = readSlot(slot);

    return {
      slot,
      label: SLOTS[slot].label,
      apiKey: (data.apiKey || "").trim() || current.apiKey,
      url: normalizeUrl(data.url) || DEFAULT_AI_HUB_URL,
      model: (data.model || "").trim() || SLOTS[slot].defaultModel
    };
  }

  function validateSlot(config) {

    if (!/^https?:\/\/\S+$/.test(config.url)) {
      return `${config.label}: the URL must start with http:// or https://`;
    }

    return null;
  }

  // Sends a minimal chat request, which checks URL, key and
  // model in one go.
  async function testSlot(config) {

    if (!config.apiKey) {
      return {
        slot: config.slot,
        ok: false,
        message: "No API key entered."
      };
    }

    const invalid = validateSlot(config);

    if (invalid) {
      return { slot: config.slot, ok: false, message: invalid };
    }

    try {

      await postChat(
        config,
        {
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        },
        20000
      );

      return {
        slot: config.slot,
        ok: true,
        message: `Connected. "${config.model}" is responding.`
      };

    } catch (error) {

      return {
        slot: config.slot,
        ok: false,
        message: describeAiError(error)
      };
    }
  }

  function writeEnvFile(values) {

    const lines =
      fs.existsSync(ENV_FILE)
        ? fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)
        : [
          "# Local credentials for cpi-ai-platform.",
          "# Managed by the iFlow Studio settings dialog. Do NOT commit."
        ];

    const written = new Set();

    // Update existing entries in place, keep everything else
    const updated = lines
      .map((line) => {

        const key =
          line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];

        if (key && key in values) {
          written.add(key);
          return values[key] === null ? null : `${key}=${values[key]}`;
        }

        return line;
      })
      .filter((line) => line !== null);

    while (updated.length && !updated[updated.length - 1].trim()) {
      updated.pop();
    }

    for (const [key, value] of Object.entries(values)) {
      if (!written.has(key) && value !== null) {
        updated.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(
      ENV_FILE,
      updated.join("\n") + "\n",
      { mode: 0o600 }
    );
  }

  this.on(
    "getSetupStatus",
    () => getSetupStatus()
  );

  this.on(
    "testSetup",
    async (req) => {

      if (req.data.slot === "cpi") {
        return testCpi(resolveCpiInput(req.data.cpi));
      }

      const slot =
        req.data.slot === "secondary" ? "secondary" : "primary";

      return testSlot(
        resolveSlotInput(slot, req.data)
      );
    }
  );

  this.on(
    "saveSetup",
    async (req) => {

      if (!CAN_SAVE_SETUP) {
        return req.error(
          403,
          "Settings cannot be changed from the browser in " +
          "production. Set the AI_HUB_* environment variables " +
          "of the app instead."
        );
      }

      const primary =
        resolveSlotInput("primary", req.data.primary);

      const secondary =
        resolveSlotInput("secondary", req.data.secondary);

      if (req.data.secondary?.clear) {
        secondary.apiKey = "";
      }

      if (!primary.apiKey) {
        return req.error(400, "Please enter an API key for the primary model.");
      }

      const invalid =
        validateSlot(primary) ||
        (secondary.apiKey && validateSlot(secondary));

      if (invalid) {
        return req.error(400, invalid);
      }

      const values = {};

      for (const config of [primary, secondary]) {

        const { prefix } = SLOTS[config.slot];
        const unset = !config.apiKey;

        values[`${prefix}_API_KEY`] = unset ? null : config.apiKey;
        values[`${prefix}_URL`] = unset ? null : config.url;
        values[`${prefix}_MODEL`] = unset ? null : config.model;
      }

      // CPI section is optional; saved when anything was entered
      const cpi =
        resolveCpiInput(req.data.cpi);

      const hasCpi =
        cpi.clientId || cpi.tokenUrl || cpi.apiBaseUrl;

      if (hasCpi) {
        values.CPI_CLIENT_ID = cpi.clientId;
        values.CPI_CLIENT_SECRET = cpi.clientSecret;
        values.CPI_TOKEN_URL = cpi.tokenUrl;
        values.CPI_API_BASE_URL = cpi.apiBaseUrl;
        values.CPI_PACKAGE_ID = cpi.packageId;
      }

      // Effective immediately, no restart needed
      for (const [key, value] of Object.entries(values)) {
        if (value === null) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      // Test so the user sees the status of each model
      const tests = [await testSlot(primary)];

      if (secondary.apiKey) {
        tests.push(await testSlot(secondary));
      }

      if (hasCpi) {
        tests.push(await testCpi(cpi));
      }

      // Written last: `cds watch` restarts the server when .env
      // changes, which would otherwise cut off the tests above
      try {
        writeEnvFile(values);
      } catch (e) {
        return req.error(
          500,
          `Could not write ${ENV_FILE}: ${e.message}`
        );
      }

      return Object.assign(
        getSetupStatus(),
        { tests }
      );
    }
  );

  // ============================================================
  // AI -> COMPILER JSON
  //
  // Retries after actual compiler/factory/validation errors.
  // ============================================================

  /*
   * The AI leaves environment-specific values (endpoint URLs, credential
   * names) empty -- the user selects them afterwards. Check the draft with
   * well-formed stand-ins filled in, so missing values never count as
   * compiler errors. The stand-ins are never compiled into a ZIP.
   */
  function draftFlowFromJson(aiJson) {
    return fromJson(
      withDraftPlaceholders(
        normalizeResourceNames(aiJson)
      )
    );
  }

  async function generateCompilerJson(prompt) {

    if (!prompt || !prompt.trim()) {
      throw new Error("Prompt is required");
    }

    const MAX_ATTEMPTS = 3;

    let currentPrompt = prompt;
    let lastError = null;

    for (
      let attempt = 1;
      attempt <= MAX_ATTEMPTS;
      attempt++
    ) {

      console.log(
        `\n===== AI ATTEMPT ${attempt}/${MAX_ATTEMPTS} =====`
      );

      const systemPrompt =
        buildSystemPrompt();

      let response;

      // ========================================================
      // AI HUB CALL
      // ========================================================

      response =
        await callAiWithFallback({
          temperature: 0,

          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: currentPrompt
            }
          ]
        });


      // ========================================================
      // RAW RESPONSE
      // ========================================================

      const raw =
        response.data
          ?.choices?.[0]
          ?.message?.content;

      if (!raw) {
        throw new Error(
          "AI returned no content"
        );
      }

      console.log(
        "\n===== RAW AI RESPONSE ====="
      );

      console.log(raw);

      console.log(
        "===========================\n"
      );


      // ========================================================
      // CLEAN JSON
      // ========================================================

      let cleaned =
        raw.trim();

      cleaned =
        cleaned
          .replace(
            /^```json\s*/i,
            ""
          )
          .replace(
            /^```\s*/i,
            ""
          )
          .replace(
            /\s*```$/i,
            ""
          )
          .trim();

      let aiJson;

      try {

        aiJson =
          JSON.parse(cleaned);

      } catch (error) {

        lastError =
          "AI returned invalid JSON";

        console.error(
          lastError
        );

        if (
          attempt >= MAX_ATTEMPTS
        ) {
          throw new Error(
            lastError
          );
        }

        currentPrompt = `
The previous response was not valid JSON.

ERROR:
${lastError}

ORIGINAL USER REQUEST:
${prompt}

Return the COMPLETE corrected compiler JSON.

Return ONLY JSON.
`;

        continue;
      }


      // ========================================================
      // PARSED JSON
      // ========================================================

      console.log(
        "\n===== PARSED AI JSON ====="
      );

      console.log(
        JSON.stringify(
          aiJson,
          null,
          2
        )
      );

      console.log(
        "==========================\n"
      );


      // ========================================================
      // FACTORY
      // ========================================================

      let flow;

      try {

        flow =
          draftFlowFromJson(aiJson);

      } catch (error) {

        lastError =
          error.message ||
          String(error);

        console.error(
          "\n===== FACTORY ERROR ====="
        );

        console.error(
          lastError
        );

        console.error(
          "=========================\n"
        );

        if (
          attempt >= MAX_ATTEMPTS
        ) {
          throw new Error(
            `Invalid compiler JSON: ${lastError}`
          );
        }

        currentPrompt = `
The compiler rejected the JSON you generated.

COMPILER ERROR:
${lastError}

PREVIOUS JSON:
${JSON.stringify(
  aiJson,
  null,
  2
)}

ORIGINAL USER REQUEST:
${prompt}

Correct the JSON according to the compiler error.

IMPORTANT:

- Use ONLY compiler capabilities.
- Do NOT invent component types.
- Do NOT invent adapter types.
- Do NOT invent properties.
- Do NOT invent resource types.
- Resources MUST be objects with:
  { "type": "...", "name": "...", "content": "..." }
- Do NOT use ScriptCollection unless it exists in the compiler
  capabilities.
- If GroovyScript requires scriptName, provide scriptName.
- Preserve valid portions.
- Make all references point to real component IDs.
- Make sure every requested component is connected.
- Make sure Router route targets have corresponding
  connections.

Return the COMPLETE corrected JSON only.
`;

        continue;
      }


      // ========================================================
      // VALIDATION
      // ========================================================

      let validation;

      try {

        validation =
          validate(flow);

      } catch (error) {

        lastError =
          error.message ||
          String(error);

        console.error(
          "\n===== VALIDATION EXCEPTION ====="
        );

        console.error(
          lastError
        );

        console.error(
          "================================\n"
        );

        if (
          attempt >= MAX_ATTEMPTS
        ) {
          throw new Error(
            lastError
          );
        }

        currentPrompt = `
The compiler validation threw an error.

COMPILER ERROR:
${lastError}

PREVIOUS JSON:
${JSON.stringify(
  aiJson,
  null,
  2
)}

ORIGINAL REQUEST:
${prompt}

Correct the JSON.

Return ONLY the complete corrected JSON.
`;

        continue;
      }


      // ========================================================
      // VALIDATION RESULT
      // ========================================================

      console.log(
        "\n===== VALIDATION ====="
      );

      console.log(
        validation
      );

      console.log(
        "======================\n"
      );


      // ========================================================
      // SUCCESS
      // ========================================================

      if (
        validation.valid
      ) {

        console.log(
          `===== VALID COMPILER JSON ON ATTEMPT ${attempt} =====`
        );

        return aiJson;
      }


      // ========================================================
      // VALIDATION FAILED
      // ========================================================

      lastError =
        JSON.stringify(
          validation,
          null,
          2
        );

      console.error(
        "\n===== COMPILER VALIDATION FAILED ====="
      );

      console.error(
        lastError
      );

      console.error(
        "=======================================\n"
      );

      if (
        attempt >= MAX_ATTEMPTS
      ) {
        throw new Error(
          lastError
        );
      }


      // ========================================================
      // RETRY WITH ACTUAL VALIDATION ERROR
      // ========================================================

      currentPrompt = `
The compiler validation failed.

COMPILER VALIDATION:
${JSON.stringify(
  validation,
  null,
  2
)}

PREVIOUS JSON:
${JSON.stringify(
  aiJson,
  null,
  2
)}

ORIGINAL USER REQUEST:
${prompt}

Fix the previous JSON.

IMPORTANT:

1. The compiler validation is authoritative.

2. Do not invent component types.

3. Do not invent adapter types.

4. Do not invent properties.

5. Do not invent resource types.

6. Use ONLY compiler capabilities.

7. Preserve valid parts of the JSON.

8. Every connection target must exist.

9. Every requested component must be connected.

10. Every Router route must have the appropriate connection.

11. If the error reports that a Router has N routes but fewer
    connections, add the missing connections.

12. If a GroovyScript requires scriptName, provide scriptName.

13. Resources MUST use this generic structure:

    {
      "type": "supported-resource-type",
      "name": "filename",
      "content": "complete file content"
    }

14. Never represent resources as strings.

15. Do not use ScriptCollection unless it is explicitly
    supported by the compiler.

16. Normalize Markdown URLs to plain URLs.

Return the COMPLETE corrected compiler JSON only.
`;
    }


    throw new Error(
      lastError ||
      "Unable to generate valid compiler JSON"
    );
  }


  // ============================================================
  // BUILD FLOW
  // ============================================================

async function buildFlow(prompt) {

    let aiJson =
        await generateCompilerJson(prompt);

    // --------------------------------------------------------
    // Normalize resource filenames before compiler factory
    // --------------------------------------------------------

    aiJson =
        normalizeResourceNames(aiJson);

    // Environment values the AI left empty must be chosen by the user
    // first (draftFlow -> completeFlow) -- never compile a ZIP without them.
    const missing =
        getRequiredInputs(aiJson);

    if (missing.length > 0) {

        throw new Error(
            "This flow needs values you have to select first: " +
            missing.map(i => i.label).join("; ") +
            ". Generate the flow first and select them in the " +
            "\"Complete configuration\" dialog, or name them in the prompt."
        );
    }

    let flow;

    try {

        flow =
            fromJson(aiJson);

    } catch (error) {

        throw new Error(
            `Invalid compiler JSON: ${error.message}`
        );
    }

    const validation =
        validate(flow);

    if (
        !validation.valid
    ) {

        throw new Error(
            JSON.stringify(validation)
        );
    }

    return {
        aiJson,
        flow,
        validation
    };
}


  // ============================================================
  // TRANSLATE PROMPT
  // ============================================================

  this.on(
    "translatePrompt",
    async (req) => {

      const prompt =
        req.data?.prompt;

      if (!prompt) {
        return req.error(
          400,
          "Prompt is required"
        );
      }

      try {

        const aiJson =
          await generateCompilerJson(
            prompt
          );

        return JSON.stringify(
          aiJson
        );

      } catch (error) {

        console.error(
          "\n===== TRANSLATE ERROR ====="
        );

        console.error(
          error
        );

        console.error(
          "===========================\n"
        );

        return req.error(
          500,
          error.message ||
          "Translation failed"
        );
      }
    }
  );


  // ============================================================
  // COMPILE FLOW
  // ============================================================

  this.on(
    "compileFlow",
    async (req) => {

      const prompt =
        req.data?.prompt;

      if (!prompt) {
        return req.error(
          400,
          "Prompt is required"
        );
      }

      try {

        const {
          aiJson,
          flow,
          validation
        } =
          await buildFlow(
            prompt
          );


        const zip =
          await compileToZip(
            flow
          );


        const zipBuffer =
          Buffer.isBuffer(zip)
            ? zip
            : Buffer.from(zip);


        console.log(
          `ZIP generated: ${zipBuffer.length} bytes`
        );


        return JSON.stringify({
          status: "success",

          flowName:
            aiJson.name ||
            "AIGeneratedFlow",

          compilerJson:
            aiJson,

          validation,

          zipSize:
            zipBuffer.length,

          message:
            "AI → compiler capabilities → JSON → factory → validation → ZIP successful"
        });

      } catch (error) {

        console.error(
          "\n===== COMPILE ERROR ====="
        );

        console.error(
          error
        );

        console.error(
          "=========================\n"
        );

        return req.error(
          500,
          error.message ||
          "Compilation failed"
        );
      }
    }
  );


  // ============================================================
  // DOWNLOAD FLOW
  // ============================================================

  this.on(
    "downloadFlow",
    async (req) => {

      const prompt =
        req.data?.prompt;

      if (!prompt) {
        return req.error(
          400,
          "Prompt is required"
        );
      }

      try {

        const {
          flow,
          validation
        } =
          await buildFlow(
            prompt
          );


        if (
          !validation.valid
        ) {

          return req.error(
            400,
            JSON.stringify(
              validation
            )
          );
        }


        const zip =
          await compileToZip(
            flow
          );


        let zipBuffer;


        if (
          Buffer.isBuffer(zip)
        ) {

          zipBuffer =
            zip;

        } else if (
          zip instanceof Uint8Array
        ) {

          zipBuffer =
            Buffer.from(zip);

        } else if (
          zip instanceof ArrayBuffer
        ) {

          zipBuffer =
            Buffer.from(zip);

        } else {

          throw new Error(
            `compileToZip returned unsupported type: ${
              zip?.constructor?.name ||
              typeof zip
            }`
          );
        }


        console.log(
          `ZIP ready for download: ${zipBuffer.length} bytes`
        );


        /*
         * Return a real Readable stream.
         *
         * This avoids:
         *
         * Unexpected result type for streaming:
         * Expected stream.Readable or null but got object
         */

        return Readable.from([
          zipBuffer
        ]);

      } catch (error) {

        console.error(
          "\n===== DOWNLOAD ERROR ====="
        );

        console.error(
          error
        );

        console.error(
          "=========================\n"
        );

        return req.error(
          500,
          error.message ||
          "ZIP download failed"
        );
      }
    }
  );

  // ============================================================
  // DRAFT FLOW
  //
  // Prompt -> AI draft + the environment inputs (security material,
  // endpoints) the user still has to select. No ZIP yet.
  // ============================================================

  this.on(
    "draftFlow",
    async (req) => {

      const prompt =
        req.data?.prompt;

      if (!prompt) {
        return req.error(
          400,
          "Prompt is required"
        );
      }

      try {

        const draft =
          normalizeResourceNames(
            await generateCompilerJson(prompt)
          );

        const inputs =
          getRequiredInputs(
            draft,
            { onlyMissing: false }
          );

        return JSON.stringify({
          flowName:
            draft.name ||
            "AIGeneratedFlow",
          draft,
          inputs,
          tenantConfigured:
            tenant.isTenantConfigured()
        });

      } catch (error) {

        console.error(
          "\n===== DRAFT ERROR =====\n",
          error
        );

        return req.error(
          500,
          error.message ||
          "Draft generation failed"
        );
      }
    }
  );


  // ============================================================
  // LIST SECURITY MATERIAL
  //
  // Real names from the CPI tenant for one kind (UserCredential,
  // OAuth2ClientCredential, KeystoreAlias).
  // ============================================================

  this.on(
    "listSecurityMaterial",
    async (req) => {

      const kind =
        req.data?.kind;

      if (
        !tenant.SECURITY_MATERIAL_KINDS.includes(kind)
      ) {
        return req.error(
          400,
          `kind must be one of: ${tenant.SECURITY_MATERIAL_KINDS.join(", ")}`
        );
      }

      try {

        return JSON.stringify(
          await tenant.listSecurityMaterial(kind)
        );

      } catch (error) {

        const status =
          error.response?.status;

        console.error(
          `Security material lookup failed (${kind}):`,
          status || "",
          error.message
        );

        return req.error(
          status === 401 || status === 403 ? 403 : 502,
          status === 401 || status === 403
            ? "The CPI API service key is not allowed to read security material."
            : error.message
        );
      }
    }
  );


  // ============================================================
  // COMPLETE FLOW
  //
  // Approved draft + the user's selections -> validated ZIP.
  // The AI is NOT called again, so the flow the user reviewed is
  // exactly the flow that gets compiled.
  // ============================================================

  this.on(
    "completeFlow",
    async (req) => {

      let draft;
      let values;

      try {

        draft =
          JSON.parse(req.data?.draft || "null");

        values =
          JSON.parse(req.data?.inputs || "{}");

      } catch {

        return req.error(
          400,
          "draft and inputs must be JSON strings"
        );
      }

      if (!draft || typeof draft !== "object") {
        return req.error(
          400,
          "draft is required"
        );
      }

      try {

        const completed =
          applyInputs(
            normalizeResourceNames(draft),
            values
          );

        const stillMissing =
          getRequiredInputs(completed);

        if (stillMissing.length > 0) {
          return req.error(
            400,
            "Please fill in: " +
            stillMissing.map(i => i.label).join("; ")
          );
        }

        // Selected credentials must actually exist on the tenant.
        if (tenant.isTenantConfigured()) {

          const credentialInputs =
            getRequiredInputs(
              completed,
              { onlyMissing: false }
            ).filter(i =>
              tenant.SECURITY_MATERIAL_KINDS.includes(i.kind)
            );

          for (const input of credentialInputs) {

            const available =
              await tenant.listSecurityMaterial(input.kind);

            if (
              !available.some(m => m.name === input.currentValue)
            ) {
              return req.error(
                400,
                `${input.label}: "${input.currentValue}" does not exist on the tenant`
              );
            }
          }
        }

        const flow =
          fromJson(completed);

        const validation =
          validate(flow);

        if (!validation.valid) {
          return req.error(
            400,
            JSON.stringify(validation)
          );
        }

        const zip =
          await compileToZip(flow);

        return JSON.stringify({
          flowName:
            completed.name ||
            "AIGeneratedFlow",
          fileName:
            `${completed.name || "AIGeneratedFlow"}.zip`,
          compilerJson:
            completed,
          zipBase64:
            Buffer.from(zip).toString("base64")
        });

      } catch (error) {

        console.error(
          "\n===== COMPLETE ERROR =====\n",
          error
        );

        return req.error(
          400,
          error.message ||
          "Compilation failed"
        );
      }
    }
  );

  // ============================================================
  // CPI DEPLOYMENT
  //
  // Uses @david10ten/deployer. Credentials come from the
  // Settings dialog (CPI_* in .env) or a bound it-rt service.
  //
  // Deployments run in the background; the UI polls
  // deploymentStatus. Failed deployments keep the prompt and
  // the SAP error so "Fix & Redeploy" can feed the error back
  // to the AI and deploy the corrected flow.
  // ============================================================

  const DEFAULT_PACKAGE_ID =
    "cpipackage";

  const MAX_DEPLOY_ATTEMPTS = 5;

  // In-memory only; lost on restart, which is fine for a dev tool
  const deployments = new Map();
  let nextDeploymentId = 1;

  function getDeployer() {
    // Created per call so changes from the Settings dialog
    // apply immediately
    return new CpiDeployer();
  }

  function toBuffer(zip) {

    if (Buffer.isBuffer(zip)) {
      return zip;
    }

    if (zip instanceof Uint8Array || zip instanceof ArrayBuffer) {
      return Buffer.from(zip);
    }

    throw new Error(
      `compileToZip returned unsupported type: ${
        zip?.constructor?.name || typeof zip
      }`
    );
  }

  // Same rule the compiler uses for Bundle-SymbolicName, so the
  // designtime artifact id matches the ZIP's manifest
  function artifactIdFor(flowName) {
    return String(flowName || "GeneratedFlow").replace(/\s+/g, "_");
  }

  function describeCpiError(error) {

    const status =
      error.response?.status;

    const data =
      error.response?.data;

    const sapMessage =
      data?.error?.message?.value ||
      data?.error?.message ||
      (typeof data === "string" ? data.slice(0, 500) : null);

    if (status === 401) {
      return "CPI rejected the credentials (HTTP 401). Check client ID, secret and token URL in Settings.";
    }

    if (status === 403) {
      return `CPI denied access (HTTP 403). ${sapMessage || "Check that the service key has the API plan and the required roles."}`;
    }

    if (status) {
      return `CPI answered with HTTP ${status}: ${sapMessage || error.message}`;
    }

    return error.message;
  }

  function errorText(detail) {

    if (!detail) {
      return null;
    }

    if (typeof detail === "string") {
      return detail;
    }

    // Shape: { message: { messageText, ... }, parameter: [...] }
    const text =
      detail.message?.messageText ||
      detail.messageText;

    const params =
      Array.isArray(detail.parameter)
        ? detail.parameter.filter(Boolean).join("\n")
        : "";

    if (text) {
      return params ? `${text}\n${params}` : text;
    }

    return JSON.stringify(detail, null, 2);
  }

  function publicDeployment(d) {
    return {
      deploymentId: d.deploymentId,
      artifactId: d.artifactId,
      artifactName: d.artifactName,
      packageId: d.packageId,
      status: d.status,
      phase: d.phase,
      attempt: d.attempts.length,
      maxAttempts: MAX_DEPLOY_ATTEMPTS,
      canFix:
        ["ERROR", "TIMEOUT", "FAILED"].includes(d.status) &&
        d.attempts.length < MAX_DEPLOY_ATTEMPTS,
      error: d.error || null,
      errorDetail: d.errorDetail || null,
      updatedAt: d.updatedAt
    };
  }

  function updateDeployment(d, changes) {
    Object.assign(d, changes, { updatedAt: new Date().toISOString() });
  }

  // Builds the prompt for a fix attempt: original request plus
  // the previous JSON and SAP's error, so the AI can correct it
  function buildFixPrompt(d) {

    const last =
      d.attempts[d.attempts.length - 1];

    return `
The integration flow below was generated for this request and then
deployed to SAP Cloud Integration, but the deployment FAILED.

ORIGINAL USER REQUEST:
${d.prompt}

PREVIOUS COMPILER JSON:
${JSON.stringify(last.aiJson, null, 2)}

SAP DEPLOYMENT ERROR:
${last.error}

Fix the cause of the deployment error. Keep the flow name
"${last.aiJson?.name}" unchanged so the existing artifact is updated.

Return the COMPLETE corrected compiler JSON.

Return ONLY JSON.
`;
  }

  // Rebuilds a flow from the compiler JSON that completeFlow returned
  function compilePrebuilt(aiJson) {

    let flow;

    try {
      flow = fromJson(aiJson);
    } catch (error) {
      throw new Error(`Invalid compiler JSON: ${error.message}`);
    }

    const validation = validate(flow);

    if (!validation.valid) {
      throw new Error(JSON.stringify(validation));
    }

    return { aiJson, flow };
  }

  async function runDeployment(d, prompt, prebuiltJson) {

    const attempt = { startedAt: new Date().toISOString() };
    d.attempts.push(attempt);

    try {

      updateDeployment(d, {
        status: "RUNNING",
        phase: prebuiltJson
          ? "Preparing the generated integration flow..."
          : "Generating the integration flow with AI...",
        error: null,
        errorDetail: null
      });

      // A flow the user already generated/approved is deployed as is;
      // only fix attempts and prompt-only requests go through the AI.
      const { aiJson, flow } =
        prebuiltJson
          ? compilePrebuilt(prebuiltJson)
          : await buildFlow(prompt);

      attempt.aiJson = aiJson;

      // First attempt fixes the artifact id; fix attempts must
      // keep it so the same artifact is updated
      if (!d.artifactId) {
        d.artifactId = artifactIdFor(flow.name);
        d.artifactName = flow.name;
      } else if (artifactIdFor(flow.name) !== d.artifactId) {
        flow.name = d.artifactName;
        aiJson.name = d.artifactName;
      }

      updateDeployment(d, { phase: "Compiling the iFlow ZIP..." });

      const zipBuffer =
        toBuffer(await compileToZip(flow));

      const deployer =
        getDeployer();

      // Fails fast with a clear message when credentials are missing
      deployer.getCredentials();

      updateDeployment(d, {
        phase: `Uploading "${d.artifactId}" to package "${d.packageId}"...`
      });

      await deployer.createOrUpdateArtifact({
        id: d.artifactId,
        name: d.artifactName,
        packageId: d.packageId,
        zipBase64: zipBuffer.toString("base64")
      });

      updateDeployment(d, { phase: "Deploying on the CPI tenant..." });

      await deployer.deployArtifact(d.artifactId);

      updateDeployment(d, {
        phase: "Waiting for the runtime status (this can take a minute)..."
      });

      const result =
        await deployer.pollDeploymentStatus(d.artifactId, {
          timeoutMs: 180000,
          intervalMs: 5000
        });

      if (result.status === "STARTED") {
        attempt.status = "STARTED";
        updateDeployment(d, {
          status: "STARTED",
          phase: "Deployed and started successfully."
        });
        return;
      }

      if (result.status === "TIMEOUT") {
        attempt.status = "TIMEOUT";
        attempt.error =
          "Deployment did not reach a final status within 3 minutes. " +
          "It may still be starting; check the Integration Suite monitor.";
        updateDeployment(d, {
          status: "TIMEOUT",
          phase: "Status check timed out.",
          error: attempt.error
        });
        return;
      }

      // ERROR: pull the details SAP reports for the artifact
      updateDeployment(d, { phase: "Deployment failed, fetching SAP error details..." });

      let detail = null;

      try {
        detail = await deployer.getArtifactError(d.artifactId);
      } catch (e) {
        console.error("Could not load artifact error:", describeCpiError(e));
      }

      attempt.status = "ERROR";
      attempt.error =
        errorText(detail) ||
        "SAP reported a deployment error but returned no details. " +
        "Check adapter configuration and required properties.";

      updateDeployment(d, {
        status: "ERROR",
        phase: "Deployment failed.",
        error: attempt.error,
        errorDetail:
          detail && typeof detail === "object"
            ? JSON.stringify(detail, null, 2)
            : null
      });

    } catch (error) {

      console.error("Deployment failed:", error);

      attempt.status = "FAILED";
      attempt.error =
        error.response ? describeCpiError(error) : error.message;

      updateDeployment(d, {
        status: "FAILED",
        phase: "Deployment could not be completed.",
        error: attempt.error
      });
    }
  }

  this.on(
    "deployFlow",
    async (req) => {

      const prompt =
        (req.data?.prompt || "").trim();

      let flowJson = null;

      if (req.data?.flowJson) {
        try {
          flowJson = JSON.parse(req.data.flowJson);
        } catch {
          return req.error(400, "flowJson must be a JSON string");
        }
        if (!flowJson || typeof flowJson !== "object") {
          return req.error(400, "flowJson must be a JSON object");
        }
      }

      if (!prompt && !flowJson) {
        return req.error(400, "Prompt is required");
      }

      const d = {
        deploymentId: String(nextDeploymentId++),
        prompt: prompt || flowJson.name || "",
        packageId:
          (req.data.packageId || "").trim() ||
          process.env.CPI_PACKAGE_ID ||
          DEFAULT_PACKAGE_ID,
        artifactId: null,
        artifactName: null,
        attempts: [],
        status: "RUNNING",
        phase: "Queued..."
      };

      deployments.set(d.deploymentId, d);

      // Not awaited: the UI polls deploymentStatus
      runDeployment(d, prompt, flowJson);

      return publicDeployment(d);
    }
  );

  this.on(
    "fixAndRedeploy",
    async (req) => {

      const d =
        deployments.get(req.data?.deploymentId);

      if (!d) {
        return req.error(404, "Unknown deployment. It may have been lost after a server restart.");
      }

      if (d.status === "RUNNING") {
        return req.error(409, "This deployment is still running.");
      }

      if (!publicDeployment(d).canFix) {
        return req.error(
          400,
          d.attempts.length >= MAX_DEPLOY_ATTEMPTS
            ? `Maximum of ${MAX_DEPLOY_ATTEMPTS} attempts reached. Adjust the scenario and deploy again.`
            : "This deployment has not failed, nothing to fix."
        );
      }

      const last =
        d.attempts[d.attempts.length - 1];

      // If the AI step itself failed there is no JSON to correct,
      // so retry with the original prompt
      const prompt =
        last.aiJson ? buildFixPrompt(d) : d.prompt;

      updateDeployment(d, { status: "RUNNING", phase: "Queued for fix..." });

      runDeployment(d, prompt);

      return publicDeployment(d);
    }
  );

  this.on(
    "deploymentStatus",
    (req) => {

      const d =
        deployments.get(req.data?.deploymentId);

      if (!d) {
        return req.error(404, "Unknown deployment. It may have been lost after a server restart.");
      }

      return publicDeployment(d);
    }
  );

  // Flows currently in ERROR on the tenant, with SAP's reason
  this.on(
    "listDeploymentErrors",
    async (req) => {

      try {

        const deployer =
          getDeployer();

        const artifacts =
          await deployer.listArtifacts({ status: "ERROR" });

        return Promise.all(
          artifacts.map(async (a) => {

            let error = null;

            try {
              error = errorText(await deployer.getArtifactError(a.Id));
            } catch (e) {
              error = `Could not load details: ${describeCpiError(e)}`;
            }

            return {
              artifactId: a.Id,
              artifactName: a.Name,
              deployedBy: a.DeployedBy,
              deployedOn: a.DeployedOn,
              error: error || "No details reported by SAP."
            };
          })
        );

      } catch (error) {
        return req.error(
          error.response ? 502 : 400,
          error.response ? describeCpiError(error) : error.message
        );
      }
    }
  );

  function normalizeResourceNames(aiJson) {

    if (
        !aiJson ||
        !Array.isArray(aiJson.resources)
    ) {
        return aiJson;
    }

    aiJson.resources =
        aiJson.resources.map(resource => {

            if (
                !resource ||
                typeof resource.name !== "string"
            ) {
                return resource;
            }

            let name =
                resource.name.trim();

            // Remove leading slash
            name =
                name.replace(/^\/+/, "");

            // Remove duplicated resource directory
            if (
                resource.type &&
                name.startsWith(
                    `${resource.type}/`
                )
            ) {
                name =
                    name.substring(
                        resource.type.length + 1
                    );
            }

            resource.name = name;

            return resource;
        });

    return aiJson;
}

});