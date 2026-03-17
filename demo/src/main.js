import './styles.css';
import '@simprints/simface-sdk';
import { SimFaceAPIClient, enroll as sdkEnroll, verify as sdkVerify } from '@simprints/simface-sdk';
import { DEFAULT_API_URL, readStoredConfig, writeStoredConfig } from './config-storage.js';

const defaults = {
  apiUrl: DEFAULT_API_URL,
  projectId: '',
  apiKey: '',
  clientId: 'demo-user-123',
  presentationMode: 'embedded',
};

const fields = {
  apiUrl: document.querySelector('#api-url'),
  projectId: document.querySelector('#project-id'),
  apiKey: document.querySelector('#api-key'),
  clientId: document.querySelector('#client-id'),
  presentationMode: document.querySelector('#presentation-mode'),
};

const buttons = {
  validate: document.querySelector('#validate-button'),
  enroll: document.querySelector('#enroll-button'),
  verify: document.querySelector('#verify-button'),
};

const clearLogButton = document.querySelector('#clear-log-button');
const statusBadge = document.querySelector('#status-badge');
const statusCopy = document.querySelector('#status-copy');
const resultOutput = document.querySelector('#result-output');
const eventLog = document.querySelector('#event-log');
const captureElement = document.querySelector('#inline-capture');
const captureCard = document.querySelector('.card-capture');

loadConfig();
initializeCaptureComponent();
wireInputPersistence();
wireActions();
updateCaptureCardVisibility();

function initializeCaptureComponent() {
  captureElement.embedded = true;
  captureElement.active = false;
  captureElement.capturePreference = 'auto-preferred';
  captureElement.label = 'Choose Enroll or Verify to begin capture.';
  captureElement.idleFeedbackLabel = 'Start Enroll or Verify to see camera guidance here.';
  captureElement.confirmLabel = 'Accept';
}

function loadConfig() {
  const saved = readStoredConfig(window.localStorage);
  const config = { ...defaults, ...saved };
  writeStoredConfig(window.localStorage, config);

  for (const [key, field] of Object.entries(fields)) {
    field.value = config[key] ?? '';
  }
}

function wireInputPersistence() {
  for (const field of Object.values(fields)) {
    field.addEventListener('input', persistConfig);
  }

  fields.presentationMode.addEventListener('change', () => {
    persistConfig();
    updateCaptureCardVisibility();
  });
}

function updateCaptureCardVisibility() {
  const isEmbedded = fields.presentationMode.value === 'embedded';
  captureCard.style.display = isEmbedded ? '' : 'none';
}

function persistConfig() {
  writeStoredConfig(window.localStorage, getConfig());
}

function wireActions() {
  buttons.validate.addEventListener('click', runValidateAction);
  buttons.enroll.addEventListener('click', () => startComponentCapture('enroll'));
  buttons.verify.addEventListener('click', () => startComponentCapture('verify'));
  clearLogButton.addEventListener('click', clearLog);
}

function getConfig() {
  return {
    apiUrl: normalizeApiUrl(fields.apiUrl.value),
    projectId: fields.projectId.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    clientId: fields.clientId.value.trim(),
    presentationMode: fields.presentationMode.value,
  };
}

function requireConfig(action) {
  const config = getConfig();

  if (!config.apiUrl || !config.projectId || !config.apiKey) {
    throw new Error('API URL, project ID, and API key are required.');
  }

  if ((action === 'enroll' || action === 'verify') && !config.clientId) {
    throw new Error('Client ID is required for enroll and verify actions.');
  }

  return config;
}

async function runValidateAction() {
  await runAction('validate', async (config) => {
    const client = new SimFaceAPIClient(config);
    return client.validateAPIKey();
  });
}

async function runAction(action, executor) {
  let config;

  try {
    config = requireConfig(action);
  } catch (error) {
    handleActionError(action, error, 'Configuration incomplete');
    return;
  }

  persistConfig();
  setBusy(action, true);
  setStatus('running', describeActionStart(action));
  appendLog('info', describeActionStart(action));

  try {
    const t0 = performance.now();
    const result = await executor(config);
    const latencyMs = Math.round(performance.now() - t0);
    const summary = summarizeActionResult(action, result);
    setStatus(summary.kind, summary.message);
    setResult({ action, ok: true, result, latencyMs });
    appendLog(summary.logKind, summary.message, result, { label: 'api', ms: latencyMs });
  } catch (error) {
    const message = describeError(error);
    setStatus('error', message);
    setResult({ action, ok: false, error: message });
    appendLog('error', message);
  } finally {
    setBusy(action, false);
  }
}

function startComponentCapture(action) {
  let config;

  try {
    config = requireConfig(action);
  } catch (error) {
    handleActionError(action, error, 'Configuration incomplete');
    return;
  }

  persistConfig();

  if (config.presentationMode === 'popup') {
    void startPopupCapture(action, config);
  } else {
    void startEmbeddedCapture(action, config);
  }
}

async function startEmbeddedCapture(action, config) {
  const sdkConfig = createSdkConfig(config);
  const workflowOptions = createWorkflowOptions();
  captureElement.embedded = true;
  captureElement.label = `Capture a face for ${action}.`;
  captureElement.confirmLabel = 'Accept';

  setBusy(action, true);
  setStatus('running', `${capitalize(action)} flow started. The SDK capture component is active in the page.`);
  appendLog('info', `${capitalize(action)} flow started in the embedded SDK component.`);
  try {
    const t0 = performance.now();
    const result = action === 'enroll'
      ? await sdkEnroll(sdkConfig, config.clientId, workflowOptions, captureElement)
      : await sdkVerify(sdkConfig, config.clientId, workflowOptions, captureElement);
    const latencyMs = Math.round(performance.now() - t0);

    const summary = summarizeActionResult(action, result);
    setStatus(summary.kind, summary.message);
    setResult({ action, ok: true, result, latencyMs });
    appendLog(summary.logKind, `${summary.message} Capture was completed by the embedded SDK component.`, result, { label: 'flow', ms: latencyMs });
  } catch (error) {
    const message = describeError(error);
    setStatus('error', message);
    setResult({ action, ok: false, error: message });
    appendLog('error', message);
  } finally {
    setBusy(action, false);
    resetCaptureComponent();
  }
}

async function startPopupCapture(action, config) {
  const sdkConfig = createSdkConfig(config);
  const workflowOptions = createWorkflowOptions();

  setBusy(action, true);
  setStatus('running', `${capitalize(action)} flow started. The SDK popup dialog will open.`);
  appendLog('info', `${capitalize(action)} flow started in popup mode.`);

  try {
    const t0 = performance.now();
    const result = action === 'enroll'
      ? await sdkEnroll(sdkConfig, config.clientId, workflowOptions)
      : await sdkVerify(sdkConfig, config.clientId, workflowOptions);
    const latencyMs = Math.round(performance.now() - t0);

    const summary = summarizeActionResult(action, result);
    setStatus(summary.kind, summary.message);
    setResult({ action, ok: true, result, latencyMs });
    appendLog(summary.logKind, `${summary.message} Capture was completed via popup.`, result, { label: 'flow', ms: latencyMs });
  } catch (error) {
    const message = describeError(error);
    setStatus('error', message);
    setResult({ action, ok: false, error: message });
    appendLog('error', message);
  } finally {
    setBusy(action, false);
  }
}

function resetCaptureComponent() {
  captureElement.active = false;
  captureElement.label = 'Choose Enroll or Verify to begin capture.';
  captureElement.idleFeedbackLabel = 'Start Enroll or Verify to see camera guidance here.';
  captureElement.confirmLabel = 'Accept';
}

function createSdkConfig(config) {
  return {
    apiUrl: config.apiUrl,
    projectId: config.projectId,
    apiKey: config.apiKey,
  };
}

function createWorkflowOptions() {
  return {
    capturePreference: captureElement.capturePreference,
    allowMediaPickerFallback: captureElement.allowMediaPickerFallback,
  };
}

function handleActionError(action, error, statusMessage) {
  const message = describeError(error);
  setStatus('error', statusMessage);
  setResult({ action, ok: false, error: message });
  appendLog('error', message);
}

function setBusy(currentAction, busy) {
  for (const [action, button] of Object.entries(buttons)) {
    button.disabled = busy;
    button.textContent = busy && action === currentAction ? `${capitalize(action)}...` : defaultButtonLabel(action);
  }
}

function setStatus(kind, message) {
  statusBadge.className = `status status-${kind}`;
  statusBadge.textContent = capitalize(kind);
  statusCopy.textContent = message;
}

function setResult(payload) {
  resultOutput.textContent = JSON.stringify(payload, null, 2);
}

function appendLog(kind, message, details, latency) {
  const emptyItem = eventLog.querySelector('.event-log-empty');
  if (emptyItem) {
    emptyItem.remove();
  }

  const item = document.createElement('li');
  item.className = `event-item event-item-${kind}`;

  const timestamp = new Date().toLocaleTimeString();
  const latencyText = latency ? ` (${latency.label}: ${latency.ms}ms)` : '';
  const detailText = details ? `\n${JSON.stringify(details, null, 2)}` : '';
  item.textContent = `[${timestamp}] ${message}${latencyText}${detailText}`;

  eventLog.prepend(item);
}

function clearLog() {
  eventLog.innerHTML = '<li class="event-log-empty">The demo log is empty.</li>';
}

function describeActionStart(action) {
  if (action === 'validate') {
    return 'Validating API credentials against the configured backend.';
  }

  return `${capitalize(action)} flow started. The SDK capture component will run inline in the page.`;
}

function summarizeActionResult(action, result) {
  if (action === 'validate') {
    return {
      kind: 'success',
      logKind: 'success',
      message: `Credentials accepted for project "${result.projectId}".`,
    };
  }

  if (action === 'enroll') {
    if (result.alreadyEnrolled) {
      return {
        kind: 'idle',
        logKind: 'info',
        message: 'User is already enrolled. Try verify instead.',
      };
    }

    if (!result.success) {
      return {
        kind: 'idle',
        logKind: 'info',
        message: result.message || 'Enrollment did not complete.',
      };
    }

    return {
      kind: 'success',
      logKind: 'success',
      message: `User "${result.clientId}" enrolled successfully.`,
    };
  }

  if (result.notEnrolled) {
    return {
      kind: 'idle',
      logKind: 'info',
      message: 'User is not enrolled yet. Run enroll first.',
    };
  }

  if (result.message && !result.match && result.score === 0 && result.threshold === 0) {
    return {
      kind: 'idle',
      logKind: 'info',
      message: result.message,
    };
  }

  if (result.match) {
    return {
      kind: 'success',
      logKind: 'success',
      message: `Verification matched with score ${formatScore(result.score)}.`,
    };
  }

  return {
    kind: 'idle',
    logKind: 'info',
    message: `Verification did not match. Score ${formatScore(result.score)} vs threshold ${formatScore(result.threshold)}.`,
  };
}

function describeError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'The demo action failed with an unknown error.';
}

function defaultButtonLabel(action) {
  if (action === 'validate') return 'Validate API key';
  if (action === 'enroll') return 'Enroll user';
  return 'Verify user';
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatScore(value) {
  return Number(value).toFixed(4);
}
