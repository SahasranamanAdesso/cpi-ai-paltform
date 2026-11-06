@path: '/cpi'
service CPIService {
     @(Core: {
        MediaType: 'application/zip',
        ContentDisposition.Filename: 'flow.zip'
    })
    type FlowZip : LargeBinary;

    // --------------------------------------------------------
    // AI Hub settings (Settings dialog in iFlow Studio)
    // --------------------------------------------------------

    type ModelSlotStatus {
        configured : Boolean;
        url        : String;
        model      : String;
        keyHint    : String;   // masked key, never the full key
    }

    type CpiStatus {
        configured : Boolean;
        clientId   : String;
        secretHint : String;   // masked, never the full secret
        tokenUrl   : String;
        apiBaseUrl : String;
        packageId  : String;
    }

    type CpiInput {
        clientId     : String;
        clientSecret : String;  // empty = keep the current secret
        tokenUrl     : String;
        apiBaseUrl   : String;
        packageId    : String;
    }

    type SetupTestResult {
        slot    : String;
        ok      : Boolean;
        message : String;
    }

    type SetupStatus {
        configured         : Boolean;  // at least one model has a key
        canSave            : Boolean;  // false in production
        envFile            : String;
        models             : array of String;
        primary            : ModelSlotStatus;
        secondary          : ModelSlotStatus;
        cpi                : CpiStatus;
        lastModel          : String;   // model that answered last
        lastSlot           : String;
        lastAt             : String;
        lastFallbackReason : String;
        tests              : array of SetupTestResult;
    }

    type ModelSlotInput {
        apiKey : String;   // empty = keep the current key
        url    : String;
        model  : String;
        clear  : Boolean;  // remove this slot
    }

    function getSetupStatus() returns SetupStatus;

    action testSetup(
        slot   : String,   // primary | secondary | cpi
        apiKey : String,
        url    : String,
        model  : String,
        cpi    : CpiInput
    ) returns SetupTestResult;

    action saveSetup(
        primary   : ModelSlotInput,
        secondary : ModelSlotInput,
        cpi       : CpiInput
    ) returns SetupStatus;

    // --------------------------------------------------------
    // CPI deployment (@david10ten/deployer)
    // --------------------------------------------------------

    type Deployment {
        deploymentId : String;
        artifactId   : String;
        artifactName : String;
        packageId    : String;
        status       : String;   // RUNNING | STARTED | ERROR | TIMEOUT | FAILED
        phase        : String;   // human readable progress
        attempt      : Integer;
        maxAttempts  : Integer;
        canFix       : Boolean;
        error        : LargeString;
        errorDetail  : LargeString;
        updatedAt    : String;
    }

    // flowJson = compilerJson returned by completeFlow; when given, that
    // exact flow is deployed and the AI is not called again.
    action deployFlow(
        prompt    : LargeString,
        packageId : String,
        flowJson  : LargeString
    ) returns Deployment;

    action fixAndRedeploy(
        deploymentId : String
    ) returns Deployment;

    function deploymentStatus(
        deploymentId : String
    ) returns Deployment;

    function listDeploymentErrors() returns array of {
        artifactId   : String;
        artifactName : String;
        deployedBy   : String;
        deployedOn   : String;
        error        : LargeString;
    };

    action translatePrompt(
        prompt : String
    ) returns String;

    action compileFlow(
        prompt : String
    ) returns String;

    // Prompt -> AI draft + environment inputs to select (JSON string)
    action draftFlow(
        prompt : String
    ) returns String;

    // Real security material names from the CPI tenant (JSON string)
    function listSecurityMaterial(
        kind : String
    ) returns String;

    // Approved draft + selections -> { fileName, zipBase64 } (JSON string)
    action completeFlow(
        draft  : LargeString,
        inputs : LargeString
    ) returns String;

    function downloadFlow(
        prompt : String
    ) returns FlowZip;
}
