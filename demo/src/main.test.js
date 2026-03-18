import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// SDK mock — keeps config-storage.js REAL so import-chain bugs surface.
// vi.mock is hoisted and applied before any imports are resolved.
// NOTE: constructor implementation MUST use `function` (not arrow) so that
// `new SimFaceAPIClient(...)` works — arrow functions are not constructable.
// ---------------------------------------------------------------------------
const sdkMocks = vi.hoisted(() => {
  const client = { validateAPIKey: vi.fn() };
  const ctor = vi.fn(function () { return client; });
  const enroll = vi.fn();
  const verify = vi.fn();
  return { client, ctor, enroll, verify };
});

vi.mock('@simprints/simface-sdk', () => ({
  SimFaceAPIClient: sdkMocks.ctor,
  enroll: sdkMocks.enroll,
  verify: sdkMocks.verify,
  default: undefined,
}));

// ---------------------------------------------------------------------------
// Minimal DOM skeleton matching demo/index.html
// ---------------------------------------------------------------------------
const DEMO_HTML = `
<div class="page">
  <form id="config-form" class="config-form">
    <input id="api-url" type="url" value="" />
    <input id="project-id" type="text" value="" />
    <input id="api-key" type="password" value="" />
    <input id="client-id" type="text" value="" />
    <select id="presentation-mode">
      <option value="embedded">Embedded</option>
      <option value="popup">Popup</option>
    </select>
  </form>

  <div class="actions">
    <button id="validate-button" type="button">Validate API key</button>
    <button id="enroll-button" type="button">Enroll user</button>
    <button id="verify-button" type="button">Verify user</button>
  </div>

  <section class="card card-capture">
    <simface-capture
      id="inline-capture"
      embedded
      label="Choose Enroll or Verify to begin capture."
      idle-feedback-label="Start Enroll or Verify to see camera guidance here."
    ></simface-capture>
  </section>

  <div class="status-row">
    <span id="status-badge" class="status status-idle">Idle</span>
  </div>
  <p id="status-copy"></p>
  <pre id="result-output">No action has been run yet.</pre>

  <button id="clear-log-button" type="button">Clear log</button>
  <ul id="event-log">
    <li class="event-log-empty">The demo log is empty.</li>
  </ul>
</div>
`;

// ---------------------------------------------------------------------------
// Provide a working localStorage stub (jsdom needs an explicit URL for
// native localStorage; the vitest jsdom env may not supply it).
// ---------------------------------------------------------------------------
function installLocalStorageStub() {
  const store = new Map();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i) => [...store.keys()][i] ?? null,
    },
    configurable: true,
    writable: true,
  });
  return store;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fillConfig(overrides = {}) {
  const vals = {
    apiUrl: 'https://api.example.com',
    projectId: 'project-1',
    apiKey: 'secret-key',
    clientId: 'user-1',
    ...overrides,
  };
  document.querySelector('#api-url').value = vals.apiUrl;
  document.querySelector('#project-id').value = vals.projectId;
  document.querySelector('#api-key').value = vals.apiKey;
  document.querySelector('#client-id').value = vals.clientId;
}

function click(selector) {
  document.querySelector(selector).click();
}

function resultJSON() {
  return JSON.parse(document.querySelector('#result-output').textContent);
}

function statusBadgeText() {
  return document.querySelector('#status-badge').textContent;
}

/** Wait for any in-flight async action to fully complete (buttons re-enabled). */
async function waitForIdle() {
  await vi.waitFor(() => {
    expect(document.querySelector('#validate-button').disabled).toBe(false);
    expect(document.querySelector('#enroll-button').disabled).toBe(false);
    expect(document.querySelector('#verify-button').disabled).toBe(false);
  });
}

// ---------------------------------------------------------------------------
// Test suite — imports main.js once; resets form / mock state between tests.
// ---------------------------------------------------------------------------
describe('demo main (integration)', () => {
  let lsStore;

  beforeAll(async () => {
    lsStore = installLocalStorageStub();
    document.body.innerHTML = DEMO_HTML;
    // Dynamic import triggers main.js top-level wiring against the DOM
    await import('./main.js');
  });

  beforeEach(() => {
    // Reset method mocks (clears calls + implementation — each test sets its own)
    sdkMocks.client.validateAPIKey.mockReset();
    sdkMocks.enroll.mockReset();
    sdkMocks.verify.mockReset();
    // Clear constructor call tracking only (preserve the constructor impl)
    sdkMocks.ctor.mockClear();
    lsStore.clear();

    // Reset form fields to empty (tests fill what they need)
    document.querySelector('#api-url').value = '';
    document.querySelector('#project-id').value = '';
    document.querySelector('#api-key').value = '';
    document.querySelector('#client-id').value = '';
    document.querySelector('#presentation-mode').value = 'embedded';

    // Reset status / result / log
    document.querySelector('#status-badge').className = 'status status-idle';
    document.querySelector('#status-badge').textContent = 'Idle';
    document.querySelector('#status-copy').textContent = '';
    document.querySelector('#result-output').textContent = 'No action has been run yet.';
    document.querySelector('#event-log').innerHTML =
      '<li class="event-log-empty">The demo log is empty.</li>';

    // Re-show capture card (in case a previous test toggled popup mode)
    document.querySelector('.card-capture').style.display = '';

    // Re-enable buttons (in case a previous test left them disabled)
    document.querySelector('#validate-button').disabled = false;
    document.querySelector('#enroll-button').disabled = false;
    document.querySelector('#verify-button').disabled = false;
  });

  // ---- Initialization -----------------------------------------------------

  it('loads and initializes without errors', () => {
    expect(document.querySelector('#validate-button')).toBeTruthy();
    expect(document.querySelector('#inline-capture')).toBeTruthy();
  });

  it('sets default properties on the capture component', () => {
    const el = document.querySelector('#inline-capture');
    expect(el.embedded).toBe(true);
    expect(el.active).toBe(false);
    expect(el.capturePreference).toBe('auto-preferred');
  });

  it('shows the capture card in embedded mode by default', () => {
    const card = document.querySelector('.card-capture');
    expect(card.style.display).not.toBe('none');
  });

  // ---- Config validation --------------------------------------------------

  it('shows error when Validate is clicked with empty config', async () => {
    click('#validate-button');
    await vi.waitFor(() => {
      const result = resultJSON();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/required/i);
    });
    // Config error is synchronous — no async action in flight
  });

  it('shows error when Enroll is clicked without a client ID', async () => {
    fillConfig({ clientId: '' });
    click('#enroll-button');
    await vi.waitFor(() => {
      const result = resultJSON();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/client id/i);
    });
  });

  // ---- Validate action (SDK integration) ----------------------------------

  it('calls SimFaceAPIClient.validateAPIKey with correct config', async () => {
    fillConfig();
    sdkMocks.client.validateAPIKey.mockResolvedValue({
      valid: true,
      projectId: 'project-1',
      name: 'Test',
    });

    click('#validate-button');

    await vi.waitFor(() => {
      expect(sdkMocks.ctor).toHaveBeenCalledWith(
        expect.objectContaining({
          apiUrl: 'https://api.example.com',
          projectId: 'project-1',
          apiKey: 'secret-key',
        }),
      );
      expect(sdkMocks.client.validateAPIKey).toHaveBeenCalled();
    });
    await waitForIdle();
  });

  it('shows success status after successful validation', async () => {
    fillConfig();
    sdkMocks.client.validateAPIKey.mockResolvedValue({
      valid: true,
      projectId: 'project-1',
      name: 'Test',
    });

    click('#validate-button');

    await vi.waitFor(() => {
      expect(statusBadgeText()).toBe('Success');
      const result = resultJSON();
      expect(result.ok).toBe(true);
      expect(result.action).toBe('validate');
    });
    await waitForIdle();
  });

  it('shows error status when validation fails', async () => {
    fillConfig();
    sdkMocks.client.validateAPIKey.mockRejectedValue(new Error('invalid credentials'));

    click('#validate-button');

    await vi.waitFor(() => {
      expect(statusBadgeText()).toBe('Error');
      const result = resultJSON();
      expect(result.ok).toBe(false);
      expect(result.error).toBe('invalid credentials');
    });
    await waitForIdle();
  });

  // ---- Enroll / Verify actions --------------------------------------------

  it('calls sdkEnroll with correct params in embedded mode', async () => {
    fillConfig();
    sdkMocks.enroll.mockResolvedValue({ success: true, clientId: 'user-1' });

    click('#enroll-button');

    await vi.waitFor(() => {
      expect(sdkMocks.enroll).toHaveBeenCalledWith(
        expect.objectContaining({
          apiUrl: 'https://api.example.com',
          projectId: 'project-1',
          apiKey: 'secret-key',
        }),
        'user-1',
        expect.objectContaining({ capturePreference: 'auto-preferred' }),
        document.querySelector('#inline-capture'),
      );
    });
    await waitForIdle();
  });

  it('calls sdkVerify with correct params in embedded mode', async () => {
    fillConfig();
    sdkMocks.verify.mockResolvedValue({ match: true, score: 0.95, threshold: 0.5 });

    click('#verify-button');

    await vi.waitFor(() => {
      expect(sdkMocks.verify).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'project-1' }),
        'user-1',
        expect.any(Object),
        document.querySelector('#inline-capture'),
      );
    });
    await waitForIdle();
  });

  it('shows idle message when user is already enrolled', async () => {
    fillConfig();
    sdkMocks.enroll.mockResolvedValue({ alreadyEnrolled: true });

    click('#enroll-button');

    await vi.waitFor(() => {
      const result = resultJSON();
      expect(result.ok).toBe(true);
      expect(statusBadgeText()).toBe('Idle');
    });
    await waitForIdle();
  });

  it('shows success with score on verification match', async () => {
    fillConfig();
    sdkMocks.verify.mockResolvedValue({ match: true, score: 0.9512, threshold: 0.5 });

    click('#verify-button');

    await vi.waitFor(() => {
      expect(statusBadgeText()).toBe('Success');
      const copy = document.querySelector('#status-copy').textContent;
      expect(copy).toMatch(/0\.9512/);
    });
    await waitForIdle();
  });

  // ---- UI behaviour -------------------------------------------------------

  it('disables all action buttons while an action is running', async () => {
    fillConfig();
    let resolveValidate;
    sdkMocks.client.validateAPIKey.mockReturnValue(
      new Promise((r) => { resolveValidate = r; }),
    );

    click('#validate-button');

    await vi.waitFor(() => {
      expect(document.querySelector('#validate-button').disabled).toBe(true);
      expect(document.querySelector('#enroll-button').disabled).toBe(true);
      expect(document.querySelector('#verify-button').disabled).toBe(true);
    });

    resolveValidate({ valid: true, projectId: 'p', name: 'n' });
    await waitForIdle();
  });

  it('hides capture card when switching to popup mode', () => {
    const select = document.querySelector('#presentation-mode');
    const card = document.querySelector('.card-capture');

    select.value = 'popup';
    select.dispatchEvent(new Event('change'));
    expect(card.style.display).toBe('none');

    select.value = 'embedded';
    select.dispatchEvent(new Event('change'));
    expect(card.style.display).not.toBe('none');
  });

  it('appends entries to the event log on each action', async () => {
    fillConfig();
    sdkMocks.client.validateAPIKey.mockResolvedValue({
      valid: true,
      projectId: 'project-1',
      name: 'Test',
    });

    click('#validate-button');

    await vi.waitFor(() => {
      const items = document.querySelectorAll('#event-log .event-item');
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
    await waitForIdle();
  });

  it('clears the event log when Clear log is clicked', async () => {
    fillConfig();
    sdkMocks.client.validateAPIKey.mockResolvedValue({
      valid: true,
      projectId: 'project-1',
      name: 'Test',
    });

    click('#validate-button');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#event-log .event-item').length).toBeGreaterThan(0);
    });
    await waitForIdle();

    click('#clear-log-button');

    const items = document.querySelectorAll('#event-log .event-item');
    expect(items.length).toBe(0);
    expect(document.querySelector('#event-log .event-log-empty')).toBeTruthy();
  });
});
