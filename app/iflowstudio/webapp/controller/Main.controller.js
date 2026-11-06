sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Input",
    "sap/m/ComboBox",
    "sap/m/MessageStrip",
    "sap/m/VBox",
    "sap/ui/core/ListItem"
], function (
    Controller,
    JSONModel,
    MessageToast,
    MessageBox,
    Dialog,
    Button,
    Label,
    Input,
    ComboBox,
    MessageStrip,
    VBox,
    ListItem
) {
    "use strict";

    /** RequiredInput kinds that are picked from the tenant's security material. */
    const SECURITY_KINDS = {
        UserCredential: "User Credentials",
        OAuth2ClientCredential: "OAuth2 Client Credentials",
        KeystoreAlias: "Keystore entry"
    };

    const PLACEHOLDERS = {
        Url: "https://...",
        Host: "host:port",
        Text: ""
    };

    return Controller.extend("iflowstudio.controller.Main", {

        onInit: function () {
            this._serviceUrl = "/cpi";

            this.getView().setModel(
                new JSONModel({
                    configured: true,
                    canSave: true,
                    models: [],
                    primary: {},
                    secondary: {},
                    cpi: {}
                }),
                "setup"
            );

            this.getView().setModel(
                new JSONModel({ tenantErrors: [] }),
                "deploy"
            );

            this.getView().setModel(
                new JSONModel({
                    generating: false,
                    generated: false,
                    flowName: ""
                }),
                "view"
            );

            this._loadSetupStatus(true);
        },

        // ====================================================
        // AI HUB SETTINGS
        // ====================================================

        _callService: async function (sPath, oOptions) {

            const response = await fetch(
                `${this._serviceUrl}/${sPath}`,
                Object.assign(
                    { headers: { "Accept": "application/json" } },
                    oOptions
                )
            );

            const oBody =
                await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    oBody?.error?.message ||
                    `HTTP ${response.status}`
                );
            }

            return oBody;
        },

        _postService: function (sAction, oData) {

            return this._callService(sAction, {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(oData)
            });
        },

        _setupModel: function () {
            return this.getView().getModel("setup");
        },

        _slotStatus: function (oSlot, oTest) {

            if (oTest) {
                return oTest.ok
                    ? { statusText: "Connected", statusState: "Success", statusIcon: "sap-icon://status-positive" }
                    : { statusText: "Failed", statusState: "Error", statusIcon: "sap-icon://status-negative" };
            }

            return oSlot.configured
                ? { statusText: "Saved", statusState: "Information", statusIcon: "sap-icon://save" }
                : { statusText: "Not configured", statusState: "None", statusIcon: "sap-icon://less" };
        },

        // Copies the server status into the model; aTests are the
        // connection results returned by saveSetup
        _applySetupStatus: function (oStatus, aTests) {

            const oModel = this._setupModel();
            const oData = oModel.getData();

            ["primary", "secondary"].forEach((sSlot) => {

                const oTest =
                    (aTests || []).find((t) => t.slot === sSlot);

                oData[sSlot] = Object.assign(
                    {},
                    oStatus[sSlot],
                    this._slotStatus(oStatus[sSlot], oTest),
                    {
                        apiKey: "",
                        clear: false,
                        apiKeyState: "None",
                        message: oTest ? oTest.message : "",
                        messageType: oTest ? (oTest.ok ? "Success" : "Error") : "None"
                    }
                );
            });

            const oCpiTest =
                (aTests || []).find((t) => t.slot === "cpi");

            oData.cpi = Object.assign(
                {},
                oStatus.cpi,
                this._slotStatus(oStatus.cpi || {}, oCpiTest),
                {
                    clientSecret: "",
                    message: oCpiTest ? oCpiTest.message : "",
                    messageType: oCpiTest ? (oCpiTest.ok ? "Success" : "Error") : "None"
                }
            );

            ["configured", "canSave", "envFile", "models",
                "lastModel", "lastSlot", "lastFallbackReason"]
                .forEach((k) => { oData[k] = oStatus[k]; });

            this._updateHeaderStatus(oData, aTests);

            oModel.refresh(true);
        },

        _updateHeaderStatus: function (oData, aTests) {

            const oPrimaryTest =
                (aTests || []).find((t) => t.slot === "primary");
            const oSecondaryTest =
                (aTests || []).find((t) => t.slot === "secondary");

            let sText, sState, sIcon;

            if (!oData.configured) {
                sText = "AI Hub not configured";
                sState = "Warning";
                sIcon = "sap-icon://alert";
            } else if (oData.lastSlot === "secondary") {
                sText = `Using fallback: ${oData.lastModel}`;
                sState = "Warning";
                sIcon = "sap-icon://switch-views";
            } else if (oPrimaryTest && !oPrimaryTest.ok) {
                sText = oSecondaryTest && oSecondaryTest.ok
                    ? `Primary failed, fallback ready: ${oData.secondary.model}`
                    : "AI Hub connection failed";
                sState = oSecondaryTest && oSecondaryTest.ok ? "Warning" : "Error";
                sIcon = "sap-icon://status-negative";
            } else {
                sText = `Ready: ${oData.lastModel || oData.primary.model}`;
                sState = "Success";
                sIcon = "sap-icon://status-positive";
            }

            oData.headerText = sText;
            oData.headerState = sState;
            oData.headerIcon = sIcon;
        },

        _loadSetupStatus: async function (bOpenIfMissing) {

            try {

                const oStatus =
                    await this._callService("getSetupStatus()");

                this._applySetupStatus(oStatus);

                if (bOpenIfMissing && !oStatus.configured) {
                    this.onOpenSetup();
                }

            } catch (error) {

                console.error(
                    "Could not load AI Hub settings:",
                    error
                );

                const oModel = this._setupModel();
                oModel.setProperty("/headerText", "Backend not reachable");
                oModel.setProperty("/headerState", "Error");
                oModel.setProperty("/headerIcon", "sap-icon://disconnected");
            }
        },

        _slotInput: function (sSlot) {

            const o =
                this._setupModel().getProperty(`/${sSlot}`) || {};

            return {
                apiKey: (o.apiKey || "").trim(),
                url: (o.url || "").trim(),
                model: (o.model || "").trim(),
                clear: !!o.clear
            };
        },

        _cpiInput: function () {

            const o =
                this._setupModel().getProperty("/cpi") || {};

            const trim = (v) => (v || "").trim();

            return {
                clientId: trim(o.clientId),
                clientSecret: trim(o.clientSecret),
                tokenUrl: trim(o.tokenUrl),
                apiBaseUrl: trim(o.apiBaseUrl),
                packageId: trim(o.packageId)
            };
        },

        // ====================================================
        // DEPLOYMENT
        // ====================================================

        _deployModel: function () {
            return this.getView().getModel("deploy");
        },

        _deployStatusUi: function (sStatus) {

            switch (sStatus) {
                case "RUNNING":
                    return { statusText: "Deploying", statusState: "Information", statusIcon: "sap-icon://synchronize" };
                case "STARTED":
                    return { statusText: "Deployed", statusState: "Success", statusIcon: "sap-icon://status-positive" };
                case "TIMEOUT":
                    return { statusText: "Timed out", statusState: "Warning", statusIcon: "sap-icon://lateness" };
                default:
                    return { statusText: "Failed", statusState: "Error", statusIcon: "sap-icon://status-negative" };
            }
        },

        _applyDeployment: function (oDeployment) {

            const oModel = this._deployModel();

            Object.assign(
                oModel.getData(),
                oDeployment,
                this._deployStatusUi(oDeployment.status)
            );

            oModel.refresh(true);

            if (oDeployment.status === "RUNNING") {
                this._scheduleDeployPoll();
                return;
            }

            // Header shows which AI model produced the flow
            this._loadSetupStatus(false);

            if (oDeployment.status === "STARTED") {
                MessageToast.show(`"${oDeployment.artifactId}" deployed successfully.`);
            }
        },

        _scheduleDeployPoll: function () {

            clearTimeout(this._deployPollTimer);

            this._deployPollTimer = setTimeout(async () => {

                const sId =
                    this._deployModel().getProperty("/deploymentId");

                try {
                    this._applyDeployment(
                        await this._callService(
                            `deploymentStatus(deploymentId='${encodeURIComponent(sId)}')`
                        )
                    );
                } catch (error) {
                    // A cds watch restart (e.g. after saving settings)
                    // loses in-memory deployments
                    this._applyDeployment(Object.assign(
                        this._deployModel().getData(),
                        {
                            status: "FAILED",
                            canFix: false,
                            phase: "Lost track of the deployment.",
                            error: error.message
                        }
                    ));
                }
            }, 3000);
        },

        onDeploy: async function () {

            const sPrompt =
                this.byId("scenarioInput").getValue().trim();

            if (!sPrompt) {
                MessageBox.warning("Please describe the integration scenario first.");
                return;
            }

            const oSetup = this._setupModel().getData();

            if (!oSetup.configured || !(oSetup.cpi && oSetup.cpi.configured)) {

                MessageBox.information(
                    !oSetup.configured
                        ? "Please configure an AI model first."
                        : "Please enter your CPI tenant details first. They are needed to deploy.",
                    { onClose: () => this.onOpenSetup() }
                );
                return;
            }

            try {

                // Reuse the generated flow only while the scenario is unchanged
                const oGenerated =
                    this._oGenerated && this._oGenerated.prompt === sPrompt
                        ? this._oGenerated
                        : null;

                this._applyDeployment(
                    await this._postService("deployFlow", {
                        prompt: sPrompt,
                        packageId: oSetup.cpi.packageId || null,
                        flowJson: oGenerated ? oGenerated.flowJson : null
                    })
                );

                if (!oGenerated) {
                    MessageToast.show("No generated flow for this scenario, generating a new one to deploy.");
                }

                this.byId("deployPanel").getDomRef()?.scrollIntoView({ behavior: "smooth" });

            } catch (error) {
                MessageBox.error(error.message);
            }
        },

        onFixAndRedeploy: async function () {

            try {

                this._applyDeployment(
                    await this._postService("fixAndRedeploy", {
                        deploymentId: this._deployModel().getProperty("/deploymentId")
                    })
                );

                MessageToast.show("Sending the SAP error to the AI and redeploying...");

            } catch (error) {
                MessageBox.error(error.message);
            }
        },

        onTenantErrorsExpand: function (oEvent) {

            if (
                oEvent.getParameter("expand") &&
                !this._deployModel().getProperty("/tenantErrorsLoaded")
            ) {
                this.onLoadTenantErrors();
            }
        },

        onLoadTenantErrors: async function () {

            const oModel = this._deployModel();

            oModel.setProperty("/loadingErrors", true);
            oModel.setProperty("/tenantErrorsMessage", "");

            try {

                const oResult =
                    await this._callService("listDeploymentErrors()");

                const aErrors = oResult.value || [];

                oModel.setProperty("/tenantErrors", aErrors);

                if (!aErrors.length) {
                    oModel.setProperty("/tenantErrorsMessageType", "Success");
                    oModel.setProperty("/tenantErrorsMessage", "No flows in ERROR status on the tenant.");
                }

            } catch (error) {

                oModel.setProperty("/tenantErrors", []);
                oModel.setProperty("/tenantErrorsMessageType", "Error");
                oModel.setProperty("/tenantErrorsMessage", error.message);

            } finally {

                oModel.setProperty("/tenantErrorsLoaded", true);
                oModel.setProperty("/loadingErrors", false);
            }
        },

        onExit: function () {
            clearTimeout(this._deployPollTimer);
        },

        onOpenSetup: async function () {

            if (!this._pSetupDialog) {

                this._pSetupDialog = this.loadFragment({
                    name: "iflowstudio.view.SetupDialog"
                });
            }

            const oDialog =
                await this._pSetupDialog;

            this._setupModel().setProperty("/message", "");

            oDialog.open();
        },

        onSettingsChange: function (oEvent) {

            const sId = oEvent.getSource().getId();
            const sSlot = sId.includes("secondary")
                ? "secondary"
                : (sId.includes("--cpi") ? "cpi" : "primary");
            const oModel = this._setupModel();

            oModel.setProperty(`/${sSlot}/apiKeyState`, "None");
            oModel.setProperty(`/${sSlot}/message`, "");
            oModel.setProperty("/message", "");
        },

        onTestSlot: async function (oEvent) {

            const sSlot =
                oEvent.getSource().data("slot");

            const oModel = this._setupModel();

            // testSetup only accepts these fields, "clear" is for saveSetup
            const { apiKey, url, model } = this._slotInput(sSlot);
            const oInput = sSlot === "cpi"
                ? { cpi: this._cpiInput() }
                : { apiKey, url, model };

            oModel.setProperty(`/${sSlot}/testing`, true);
            oModel.setProperty(`/${sSlot}/messageType`, "Information");
            oModel.setProperty(`/${sSlot}/message`, "Testing...");

            try {

                const oResult =
                    await this._postService(
                        "testSetup",
                        Object.assign({ slot: sSlot }, oInput)
                    );

                const oSlot = oModel.getProperty(`/${sSlot}`);

                Object.assign(oSlot, this._slotStatus(oSlot, oResult), {
                    messageType: oResult.ok ? "Success" : "Error",
                    message: oResult.ok
                        ? oResult.message + " Click Save to keep these settings."
                        : oResult.message
                });

                oModel.refresh(true);

            } catch (error) {

                oModel.setProperty(`/${sSlot}/messageType`, "Error");
                oModel.setProperty(`/${sSlot}/message`, error.message);

            } finally {

                oModel.setProperty(`/${sSlot}/testing`, false);
            }
        },

        onClearSecondary: function () {

            const oModel = this._setupModel();

            oModel.setProperty("/secondary/clear", true);
            oModel.setProperty("/secondary/apiKey", "");
            oModel.setProperty("/secondary/configured", false);
            oModel.setProperty("/secondary/keyHint", "");
            oModel.setProperty("/secondary/messageType", "Information");
            oModel.setProperty("/secondary/message", "The secondary model will be removed when you click Save.");
            Object.assign(
                oModel.getProperty("/secondary"),
                this._slotStatus({ configured: false })
            );
            oModel.refresh(true);
        },

        onSaveSetup: async function () {

            const oModel = this._setupModel();
            const oPrimary = this._slotInput("primary");

            if (!oModel.getProperty("/primary/configured") && !oPrimary.apiKey) {
                oModel.setProperty("/primary/apiKeyState", "Error");
                oModel.setProperty("/primary/apiKeyStateText", "The primary model needs an API key.");
                this.byId("primaryApiKey").focus();
                return;
            }

            oModel.setProperty("/saving", true);
            oModel.setProperty("/messageType", "Information");
            oModel.setProperty("/message", "Saving and testing the connection...");

            try {

                const oStatus =
                    await this._postService("saveSetup", {
                        primary: oPrimary,
                        secondary: this._slotInput("secondary"),
                        cpi: this._cpiInput()
                    });

                this._applySetupStatus(oStatus, oStatus.tests);

                const aTests = oStatus.tests || [];
                const bAllOk = aTests.every((t) => t.ok);
                const bAnyOk = aTests.some((t) => t.ok);

                oModel.setProperty(
                    "/messageType",
                    bAllOk ? "Success" : (bAnyOk ? "Warning" : "Error")
                );

                oModel.setProperty(
                    "/message",
                    `Saved to ${oStatus.envFile}. ` + (
                        bAllOk
                            ? "All models are connected."
                            : bAnyOk
                                ? "Some models could not connect, see details above."
                                : "The connection test failed, see details above."
                    )
                );

                MessageToast.show(
                    bAllOk ? "Settings saved, AI Hub connected." : "Settings saved, but a connection test failed."
                );

            } catch (error) {

                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", `Not saved: ${error.message}`);

            } finally {

                oModel.setProperty("/saving", false);
            }
        },

        _discardUnsavedSettings: function () {
            // Reload from the server so unsaved edits don't linger
            this._loadSetupStatus(false);
        },

        onCloseSetup: async function () {

            (await this._pSetupDialog).close();
            this._discardUnsavedSettings();
        },

        onSetupEscape: function (oPromise) {

            oPromise.resolve();
            this._discardUnsavedSettings();
        },

        onGenerateIntegrationFlow: async function () {

            if (!this.getView().getModel("setup").getProperty("/configured")) {
                this.onOpenSetup();
                return;
            }

            const sPrompt = this.byId("scenarioInput").getValue().trim();

            if (!sPrompt) {
                MessageBox.warning("Please describe the integration scenario first.");
                return;
            }

            const oViewModel = this.getView().getModel("view");
            oViewModel.setProperty("/generating", true);

            try {

                MessageToast.show("Generating integration flow...");

                const oResult = await this._callAction("draftFlow", { prompt: sPrompt });
                this._sDraftPrompt = sPrompt;

                oViewModel.setProperty("/flowName", oResult.flowName);

                const aMissing = oResult.inputs.filter(i => !i.currentValue);

                if (aMissing.length > 0) {
                    // Stays busy until the dialog is confirmed or cancelled (afterClose).
                    this._openInputsDialog(oResult);
                    return;
                }

                // Everything was stated in the prompt -- compile directly.
                await this._completeAndDownload(oResult.draft, {});

            } catch (error) {
                console.error("Integration flow generation failed:", error);
                MessageBox.error(error.message || "Unable to generate the integration flow.");
            }

            oViewModel.setProperty("/generating", false);
            this._loadSetupStatus(false);
        },

        // ------------------------------------------------------------
        // "Complete configuration" dialog
        // ------------------------------------------------------------

        _openInputsDialog: function (oDraftResult) {

            const oViewModel = this.getView().getModel("view");
            const oModel = new JSONModel({
                inputs: oDraftResult.inputs.map(i => Object.assign({ value: i.currentValue, state: "None" }, i))
            });

            const oContent = new VBox({ width: "100%" }).addStyleClass("sapUiSmallMargin");

            if (!oDraftResult.tenantConfigured) {
                oContent.addItem(new MessageStrip({
                    text: "The CPI tenant API is not configured, so security material cannot be listed. Type the exact names as they exist on your tenant.",
                    type: "Warning",
                    showIcon: true
                }).addStyleClass("sapUiSmallMarginBottom"));
            }

            oModel.getProperty("/inputs").forEach((oInput, iIndex) => {

                const sPath = `/inputs/${iIndex}`;
                const sKindLabel = SECURITY_KINDS[oInput.kind];

                oContent.addItem(new Label({
                    text: sKindLabel ? `${oInput.label} (${sKindLabel})` : oInput.label,
                    required: true,
                    wrapping: true
                }).addStyleClass("sapUiSmallMarginTop"));

                if (sKindLabel) {
                    const oCombo = new ComboBox({
                        width: "100%",
                        value: `{${sPath}/value}`,
                        valueState: `{${sPath}/state}`,
                        placeholder: oDraftResult.tenantConfigured ? "Loading from tenant..." : "Type the name",
                        showSecondaryValues: true
                    });
                    oContent.addItem(oCombo);
                    if (oDraftResult.tenantConfigured) {
                        this._loadSecurityMaterial(oInput.kind, oCombo);
                    }
                } else {
                    oContent.addItem(new Input({
                        width: "100%",
                        value: `{${sPath}/value}`,
                        valueState: `{${sPath}/state}`,
                        placeholder: PLACEHOLDERS[oInput.kind] || "",
                        type: oInput.kind === "Url" ? "Url" : "Text"
                    }));
                }
            });

            const oDialog = new Dialog({
                title: `Complete configuration: ${oDraftResult.flowName}`,
                contentWidth: "36rem",
                content: [oContent],
                beginButton: new Button({
                    text: "Generate ZIP",
                    type: "Emphasized",
                    press: async () => {
                        const oValues = this._collectInputs(oModel);
                        if (!oValues) {
                            return;
                        }
                        oDialog.setBusy(true);
                        try {
                            await this._completeAndDownload(oDraftResult.draft, oValues);
                            oDialog.close();
                        } catch (error) {
                            MessageBox.error(error.message || "Unable to compile the integration flow.");
                        } finally {
                            oDialog.setBusy(false);
                        }
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: () => oDialog.close()
                }),
                afterClose: () => {
                    oViewModel.setProperty("/generating", false);
                    oDialog.destroy();
                }
            });

            oDialog.setModel(oModel);
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        _loadSecurityMaterial: async function (sKind, oCombo) {
            try {
                const aItems = await this._callFunction("listSecurityMaterial", { kind: sKind });
                aItems.forEach(oItem => oCombo.addItem(new ListItem({
                    key: oItem.name,
                    text: oItem.name,
                    additionalText: oItem.description
                })));
                oCombo.setPlaceholder(aItems.length ? "Select from tenant" : `No ${SECURITY_KINDS[sKind]} found on the tenant`);
            } catch (error) {
                oCombo.setPlaceholder("Type the name");
                MessageToast.show(`Could not load ${SECURITY_KINDS[sKind]}: ${error.message}`);
            }
        },

        /** Returns { key: value }, or null (and marks the fields) when something is missing/invalid. */
        _collectInputs: function (oModel) {
            const oValues = {};
            let bValid = true;

            oModel.getProperty("/inputs").forEach((oInput, iIndex) => {
                const sValue = (oInput.value || "").trim();
                const bBad = !sValue || (oInput.kind === "Url" && !/^https?:\/\/\S+/i.test(sValue));
                oModel.setProperty(`/inputs/${iIndex}/state`, bBad ? "Error" : "None");
                bValid = bValid && !bBad;
                oValues[oInput.key] = sValue;
            });

            if (!bValid) {
                MessageToast.show("Please fill in every field (endpoints must start with http:// or https://).");
                return null;
            }
            return oValues;
        },

        _completeAndDownload: async function (oDraft, oValues) {
            const oResult = await this._callAction("completeFlow", {
                draft: JSON.stringify(oDraft),
                inputs: JSON.stringify(oValues)
            });

            const aBytes = Uint8Array.from(atob(oResult.zipBase64), c => c.charCodeAt(0));
            const sObjectUrl = window.URL.createObjectURL(new Blob([aBytes], { type: "application/zip" }));
            const oLink = document.createElement("a");
            oLink.href = sObjectUrl;
            oLink.download = oResult.fileName;
            document.body.appendChild(oLink);
            oLink.click();
            oLink.remove();
            window.URL.revokeObjectURL(sObjectUrl);

            // Deploy ships exactly this flow instead of regenerating it
            this._oGenerated = {
                prompt: this._sDraftPrompt,
                flowJson: JSON.stringify(oResult.compilerJson)
            };

            this.getView().getModel("view").setProperty("/generated", true);
            MessageToast.show("Integration flow ZIP downloaded successfully.");
        },

        // ------------------------------------------------------------
        // CAP service calls (actions/functions return JSON strings)
        // ------------------------------------------------------------

        _callAction: async function (sName, oBody) {
            const response = await fetch(`${this._serviceUrl}/${sName}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify(oBody)
            });
            return this._parseResponse(response);
        },

        _callFunction: async function (sName, oParams) {
            const sArgs = Object.entries(oParams)
                .map(([k, v]) => `${k}='${encodeURIComponent(String(v).replace(/'/g, "''"))}'`)
                .join(",");
            const response = await fetch(`${this._serviceUrl}/${sName}(${sArgs})`, {
                headers: { "Accept": "application/json" }
            });
            return this._parseResponse(response);
        },

        _parseResponse: async function (response) {
            const sContentType = response.headers.get("Content-Type") || "";
            const oBody = sContentType.includes("application/json")
                ? await response.json()
                : { value: await response.text() };

            if (!response.ok) {
                throw new Error(oBody?.error?.message || oBody?.value || `HTTP ${response.status}`);
            }
            return JSON.parse(oBody.value);
        }

    });

});
