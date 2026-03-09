import './styles.css';
import '@simprints/simface-sdk';
import { SimFaceAPIClient } from '@simprints/simface-sdk';

const STORAGE_KEY = 'simface-demo-config';
const DEFAULT_API_URL = 'https://simface-api-85584555549.europe-west1.run.app';

const defaults = {
  apiUrl: DEFAULT_API_URL,
  projectId: '',
  apiKey: '',
  clientId: 'demo-user-123',
};

const fields = {
  apiUrl: document.querySelector('#api-url'),
  projectId: document.querySelector('#project-id'),
  apiKey: document.querySelector('#api-key'),
  clientId: document.querySelector('#client-id'),
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

const actionSession = {
  action: null,
  config: null,
  submitting: false,
};

loadConfig();
initializeCaptureComponent();
wireInputPersistence();
wireActions();

function initializeCaptureComponent() {
  captureElement.embedded = true;
  captureElement.active = false;
  captureElement.confirmLabel = 'Confirm capture';
}

function loadConfig() {
  const saved = readStoredConfig();
  const config = { ...defaults, ...saved, apiUrl: normalizeApiUrl(saved.apiUrl) };

  for (const [key, field] of Object.entries(fields)) {
    field.value = config[key] ?? '';
  }
}

function readStoredConfig() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function wireInputPersistence() {
  for (const field of Object.values(fields)) {
    field.addEventListener('input', persistConfig);
  }
}

function persistConfig() {
  const config = getConfig();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function wireActions() {
  buttons.validate.addEventListener('click', runValidateAction);
  buttons.enroll.addEventListener('click', () => startComponentCapture('enroll'));
  buttons.verify.addEventListener('click', () => startComponentCapture('verify'));
  clearLogButton.addEventListener('click', clearLog);
  captureElement.addEventListener('simface-captured', handleComponentCaptured);
  captureElement.addEventListener('simface-cancelled', handleComponentCancelled);
  captureElement.addEventListener('simface-error', handleComponentError);
}

function getConfig() {
  return {
    apiUrl: normalizeApiUrl(fields.apiUrl.value),
    projectId: fields.projectId.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    clientId: fields.clientId.value.trim(),
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
    const result = await executor(config);
    const summary = summarizeActionResult(action, result);
    setStatus(summary.kind, summary.message);
    setResult({ action, ok: true, result });
    appendLog(summary.logKind, summary.message, result);
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
  actionSession.action = action;
  actionSession.config = config;
  actionSession.submitting = false;

  captureElement.embedded = true;
  captureElement.label = `Capture a face for ${action}.`;
  captureElement.confirmLabel = `Confirm ${action}`;
  void captureElement.startCapture();

  setBusy(action, true);
  setStatus('running', `${capitalize(action)} flow started. The SDK capture component is active in the page.`);
  appendLog('info', `${capitalize(action)} flow started in the embedded SDK component.`);
}

async function handleComponentCaptured(event) {
  if (!actionSession.action || actionSession.submitting) {
    return;
  }

  actionSession.submitting = true;
  const { imageBlob } = event.detail;
  const { action, config } = actionSession;

  setStatus('running', `Submitting ${action} request to the backend.`);
  appendLog('info', `Submitting ${action} request with a capture produced by the SDK component.`);

  try {
    const client = new SimFaceAPIClient(config);
    const result = action === 'enroll'
      ? await client.enroll(config.clientId, imageBlob)
      : await client.verify(config.clientId, imageBlob);

    const summary = summarizeActionResult(action, result);
    setStatus(summary.kind, summary.message);
    setResult({ action, ok: true, result });
    appendLog(summary.logKind, `${summary.message} Capture was completed by the SDK component.`, result);
  } catch (error) {
    const message = describeError(error);
    setStatus('error', message);
    setResult({ action, ok: false, error: message });
    appendLog('error', message);
  } finally {
    setBusy(action, false);
    resetActionSession();
  }
}

function handleComponentCancelled() {
  if (!actionSession.action || actionSession.submitting) {
    return;
  }

  const action = actionSession.action;
  appendLog('info', `${capitalize(action)} capture cancelled.`);
  setStatus('idle', 'Capture cancelled.');
  setResult({ action, ok: false, error: 'Capture cancelled by user' });
  setBusy(action, false);
  resetActionSession();
}

function handleComponentError(event) {
  if (!actionSession.action || actionSession.submitting) {
    return;
  }

  const action = actionSession.action;
  const message = event.detail?.error || 'Capture failed';
  appendLog('error', message);
  setStatus('error', message);
  setResult({ action, ok: false, error: message });
  setBusy(action, false);
  resetActionSession();
}

function resetActionSession() {
  actionSession.action = null;
  actionSession.config = null;
  actionSession.submitting = false;
  captureElement.active = false;
  captureElement.label = 'Choose Enroll or Verify to begin capture.';
  captureElement.confirmLabel = 'Confirm capture';
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

function appendLog(kind, message, details) {
  const emptyItem = eventLog.querySelector('.event-log-empty');
  if (emptyItem) {
    emptyItem.remove();
  }

  const item = document.createElement('li');
  item.className = `event-item event-item-${kind}`;

  const timestamp = new Date().toLocaleTimeString();
  const detailText = details ? `\n${JSON.stringify(details, null, 2)}` : '';
  item.textContent = `[${timestamp}] ${message}${detailText}`;

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

function normalizeApiUrl(value) {
  if (typeof value !== 'string') {
    return DEFAULT_API_URL;
  }

  const normalized = value.trim();
  return normalized || DEFAULT_API_URL;
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
