// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
'use client';
import { useEffect, useState, type FormEvent } from 'react';
type User = { id: string; role: string; mfaEnabled: boolean; csrfToken: string };
type Check = { name: string; passed: boolean; detail: string };
type Domain = {
  id: string;
  name: string;
  active: boolean;
  sendingEnabled: boolean;
  readiness: Check[] | null;
};
type DNS = { type: string; name: string; value: string; purpose: string };
type Task = { id: string; operation: string; status: string; lastError: string | null };
type Status = {
  setup: { firstDomainId: string | null; completedAt: string | null } | null;
  host: {
    available: boolean;
    method?: string;
    checks?: Check[];
    certificates?: { hostname: string; expiresAt?: string; status?: string }[];
    backupConfigured?: boolean;
    lastBackupAt?: string;
    update?: { installedRevision: string; policy: string };
    detail?: string;
  };
  connections: { zoneId: string; zoneName: string }[];
  tasks: Task[];
};
export function SetupWizard() {
  const [token, setToken] = useState(''),
    [user, setUser] = useState<User | null>(null),
    [status, setStatus] = useState<Status | null>(null),
    [domain, setDomain] = useState<Domain | null>(null),
    [records, setRecords] = useState<DNS[]>([]),
    [mailboxes, setMailboxes] = useState<{ email: string }[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null),
    [providerToken, setProviderToken] = useState(''),
    [zones, setZones] = useState<{ id: string; name: string }[]>([]),
    [zone, setZone] = useState(''),
    [preview, setPreview] = useState<{
      suggested: DNS[];
      current: { name: string; type: string; content: string }[];
    } | null>(null),
    [selected, setSelected] = useState<number[]>([]),
    [firstStep, setFirstStep] = useState(1);
  async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch('/api/v1' + path, {
      method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { 'x-csrf-token': user.csrfToken } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error?.message ?? 'This step needs attention. Please retry.');
    return result.data as T;
  }
  async function refresh() {
    const current = await api<Status>('/setup/status');
    setStatus(current);
    const id = current.setup?.firstDomainId;
    if (id) {
      const [d, r, m] = await Promise.all([
        api<Domain>('/domains/' + id),
        api<DNS[]>('/domains/' + id + '/dns'),
        api<{ email: string }[]>('/domains/' + id + '/mailboxes'),
      ]);
      setDomain(d);
      setRecords(r);
      setMailboxes(m);
    }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please retry this step.');
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<void>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      await action(data);
      form.reset();
    });
  }
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(fragment)) {
      setToken(fragment);
      window.history.replaceState(null, '', '/setup');
    }
    void fetch('/api/v1/auth/me')
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json();
          setUser(data.data);
        }
      })
      .catch(() => setError('The server is not available yet. Wait a moment and reload.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user?.mfaEnabled && user.role === 'PLATFORM_ADMIN')
      void refresh().catch((e) => setError(e.message));
  }, [user?.id, user?.mfaEnabled]);
  useEffect(() => {
    if (
      !user?.mfaEnabled ||
      !status?.tasks.some((t) => t.status === 'PENDING' || t.status === 'RUNNING')
    )
      return;
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [status?.tasks, user?.mfaEnabled]);
  const task = async (operation: string, target?: string) => {
    await api('/setup/tasks', 'POST', { operation, ...(target ? { target } : {}) });
    setNotice('Your server action is queued. Progress appears below.');
    await refresh();
  };
  if (loading)
    return (
      <main id="main" className="setup-shell">
        <p role="status">Opening your secure setup…</p>
      </main>
    );
  return (
    <main id="main" className="setup-shell">
      <header className="setup-header">
        <a className="brand" href="/">
          NSoft <strong>Mail Companion</strong>
        </a>
        <a href="/">Administration dashboard</a>
      </header>
      <p className="eyebrow">GUIDED SETUP</p>
      <h1>
        Your email server,
        <br />
        <span className="gradient">one step at a time.</span>
      </h1>
      <p className="setup-intro">
        We’ll help you connect your domain, secure your server and create your first email address.
        Your progress is saved on this server.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {!user ? (
        <section className="panel setup-card">
          <h2>{token ? 'Create your administrator' : 'Sign in to continue setup'}</h2>
          <p>
            {token
              ? 'This private setup link can be used once. Choose a strong password, then secure your account with an authenticator.'
              : 'Already created your administrator? Sign in here. An expired first-run link can be replaced by rerunning the installer on the server.'}
          </p>
          <form
            onSubmit={(e) =>
              submit(e, async (data) => {
                const body = { email: data.get('email'), password: data.get('password') };
                if (token) {
                  await api('/setup/claim', 'POST', { ...body, name: data.get('name'), token });
                  setToken('');
                } else
                  await api('/auth/login', 'POST', {
                    ...body,
                    ...(data.get('code') ? { code: data.get('code') } : {}),
                  });
                setUser(await api<User>('/auth/me'));
              })
            }
          >
            {token && <Field label="Your name" name="name" autoComplete="name" />}
            <Field label="Administrator email" name="email" type="email" autoComplete="username" />
            <Field
              label="Administrator password"
              name="password"
              type="password"
              autoComplete={token ? 'new-password' : 'current-password'}
              minLength={token ? 14 : undefined}
            />
            {!token && (
              <Field
                label="Authenticator code (if enabled)"
                name="code"
                required={false}
                autoComplete="one-time-code"
              />
            )}
            <button disabled={busy}>
              {busy ? 'Working…' : token ? 'Create administrator' : 'Sign in'}
            </button>
          </form>
        </section>
      ) : !user.mfaEnabled ? (
        <section className="panel setup-card">
          <h2>1. Protect your administrator account</h2>
          <p>Use an authenticator app to add a second layer of protection.</p>
          {!enrollment ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => setEnrollment(await api('/auth/mfa/enroll', 'POST', {})))
              }
            >
              Set up authenticator
            </button>
          ) : (
            <>
              <p>
                Add this setup key to your authenticator app, then enter its six-digit code. Keep
                the key private.
              </p>
              <code className="secret">{enrollment.secret}</code>
              <form
                onSubmit={(e) =>
                  submit(e, async (data) => {
                    await api('/auth/mfa/confirm', 'POST', { code: data.get('code') });
                    setEnrollment(null);
                    setUser(await api('/auth/me'));
                  })
                }
              >
                <Field
                  label="Six-digit authenticator code"
                  name="code"
                  autoComplete="one-time-code"
                />
                <button disabled={busy}>Verify and continue</button>
              </form>
            </>
          )}
        </section>
      ) : user.role !== 'PLATFORM_ADMIN' ? (
        <section className="panel">
          <h2>Platform administrator required</h2>
          <p>Your domain administration account cannot change server installation settings.</p>
        </section>
      ) : (
        <>
          <nav aria-label="Setup steps" className="setup-steps">
            {['Server', 'DNS provider', 'Domain', 'Mailbox', 'Delivery'].map((name, index) => (
              <button
                className={firstStep === index + 1 ? 'active' : ''}
                aria-current={firstStep === index + 1 ? 'step' : undefined}
                key={name}
                onClick={() => setFirstStep(index + 1)}
              >
                {index + 1}. {name}
              </button>
            ))}
          </nav>
          <div className="setup-controls">
            <button className="secondary" disabled={busy} onClick={() => void run(refresh)}>
              Refresh progress
            </button>
            <a href="/api/v1/setup/diagnostics" download>
              Download safe diagnostics
            </a>
          </div>
          {!status ? (
            <p role="status">Loading your saved progress…</p>
          ) : (
            <>
              {firstStep === 1 && (
                <section className="panel setup-card">
                  <h2>1. Check your server</h2>
                  <p>
                    Installation method:{' '}
                    <strong>{status.host.method ?? 'Existing Compose installation'}</strong>
                  </p>
                  {!status.host.available && <p>{status.host.detail}</p>}
                  <Checks items={status.host.checks ?? []} />
                  <p>
                    These checks run from your server. To confirm internet reception, send a message
                    from an outside account. A home connection needs public IPv4, inbound SMTP and
                    provider-controlled reverse DNS.
                  </p>
                  <button
                    disabled={busy || !status.host.available}
                    onClick={() => void run(() => task('refresh'))}
                  >
                    Retry server checks
                  </button>
                  <button className="secondary" onClick={() => setFirstStep(2)}>
                    Next: DNS provider
                  </button>
                </section>
              )}
              {firstStep === 2 && (
                <section className="panel setup-card">
                  <h2>2. Connect your DNS provider</h2>
                  <p>
                    Cloudflare can create records after you review them. Other providers work too:
                    choose manual setup and copy the records in the next step.
                  </p>
                  <h3>Cloudflare automation</h3>
                  <p>
                    Create a token with Zone Read and DNS Edit permissions for only the zones you
                    want to manage. Your token is encrypted on this server.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        setZones(
                          await api('/setup/providers/cloudflare/zones', 'POST', {
                            token: providerToken,
                          }),
                        );
                      });
                    }}
                  >
                    <label>
                      Cloudflare API token
                      <input
                        type="password"
                        value={providerToken}
                        onChange={(e) => setProviderToken(e.target.value)}
                        autoComplete="off"
                        required
                        minLength={20}
                      />
                    </label>
                    <button disabled={busy}>Find permitted zones</button>
                  </form>
                  {zones.length > 0 && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          await api('/setup/providers/cloudflare', 'POST', {
                            token: providerToken,
                            zoneId: zone,
                          });
                          setProviderToken('');
                          setZones([]);
                          await refresh();
                          setNotice('Cloudflare connected. Your token is not displayed again.');
                        });
                      }}
                    >
                      <label>
                        Choose your zone
                        <select value={zone} onChange={(e) => setZone(e.target.value)} required>
                          <option value="">Select a zone</option>
                          {zones.map((z) => (
                            <option value={z.id} key={z.id}>
                              {z.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button disabled={busy}>Connect selected zone</button>
                    </form>
                  )}
                  {status.connections.map((c) => (
                    <p key={c.zoneId}>✓ Connected: {c.zoneName}</p>
                  ))}
                  <button className="secondary" onClick={() => setFirstStep(3)}>
                    Continue with manual DNS or connected provider
                  </button>
                </section>
              )}
              {firstStep === 3 && (
                <section className="panel setup-card">
                  <h2>3. Add your first domain</h2>
                  {!domain ? (
                    <form
                      onSubmit={(e) =>
                        submit(e, async (data) => {
                          await api('/setup/first-domain', 'POST', {
                            name: data.get('domain'),
                            tenantName: data.get('tenant'),
                          });
                          await refresh();
                        })
                      }
                    >
                      <Field label="Organisation name" name="tenant" />
                      <Field label="Email domain (for example example.com)" name="domain" />
                      <button disabled={busy}>Add domain</button>
                    </form>
                  ) : (
                    <>
                      <h3>{domain.name}</h3>
                      <p>
                        Publish the ownership record first, then wait for DKIM provisioning. Review
                        existing email services before changing MX records. Existing records are
                        never silently replaced.
                      </p>
                      {records.map((r) => (
                        <div className="setup-dns" key={r.name + r.type}>
                          <strong>
                            {r.type} · {r.name}
                          </strong>
                          <code>{r.value}</code>
                          <small>{r.purpose}</small>
                          <button
                            className="secondary"
                            onClick={() =>
                              void run(async () => {
                                await navigator.clipboard.writeText(r.value);
                                setNotice('Record value copied.');
                              })
                            }
                          >
                            Copy {r.type} value
                          </button>
                        </div>
                      ))}
                      {status.connections.length > 0 && (
                        <>
                          <label>
                            Connected Cloudflare zone
                            <select value={zone} onChange={(e) => setZone(e.target.value)}>
                              <option value="">Choose a zone</option>
                              {status.connections.map((c) => (
                                <option key={c.zoneId} value={c.zoneId}>
                                  {c.zoneName}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            disabled={busy || !zone}
                            onClick={() =>
                              void run(async () => {
                                setPreview(
                                  await api(`/domains/${domain.id}/cloudflare/preview`, 'POST', {
                                    zoneId: zone,
                                  }),
                                );
                                setSelected([]);
                              })
                            }
                          >
                            Preview DNS changes
                          </button>
                          {preview && (
                            <div>
                              <h3>Approve new records</h3>
                              {preview.suggested.map((r, index) => {
                                const exists = preview.current.some(
                                  (c) => c.name === r.name && c.type === r.type,
                                );
                                const pending = r.value.includes('PENDING_');
                                return (
                                  <label className="setup-choice" key={r.name + r.type}>
                                    <input
                                      type="checkbox"
                                      disabled={exists || pending}
                                      checked={selected.includes(index)}
                                      onChange={(e) =>
                                        setSelected(
                                          e.target.checked
                                            ? [...selected, index]
                                            : selected.filter((i) => i !== index),
                                        )
                                      }
                                    />
                                    {r.type} · {r.name}
                                    {exists
                                      ? ' — existing record: review manually'
                                      : pending
                                        ? ' — wait for provisioning'
                                        : ''}
                                  </label>
                                );
                              })}
                              <button
                                disabled={busy || selected.length === 0}
                                onClick={() =>
                                  void run(async () => {
                                    await api(`/domains/${domain.id}/cloudflare/apply`, 'POST', {
                                      zoneId: zone,
                                      records: selected,
                                      confirmed: true,
                                    });
                                    setPreview(null);
                                    setNotice(
                                      'Selected records created. Wait for DNS propagation, then run checks.',
                                    );
                                  })
                                }
                              >
                                Create selected records
                              </button>
                            </div>
                          )}
                        </>
                      )}
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`/domains/${domain.id}/check`, 'POST', {});
                            setNotice('Domain checks queued. Use Refresh progress after a moment.');
                          })
                        }
                      >
                        Check domain records
                      </button>
                      <Checks items={domain.readiness ?? []} />
                      <button className="secondary" onClick={() => setFirstStep(4)}>
                        Next: first mailbox
                      </button>
                    </>
                  )}
                </section>
              )}
              {firstStep === 4 && (
                <section className="panel setup-card">
                  <h2>4. Create your first email address</h2>
                  {!domain ? (
                    <p>Add your domain in step 3 first.</p>
                  ) : (
                    <>
                      <p>
                        Domain ownership must pass before mailbox login becomes available. Start
                        with <strong>postmaster</strong> if your DMARC record sends reports there.
                      </p>
                      <form
                        onSubmit={(e) =>
                          submit(e, async (data) => {
                            await api(`/domains/${domain.id}/mailboxes`, 'POST', {
                              localPart: data.get('address'),
                              name: data.get('name'),
                              password: data.get('password'),
                              quotaMb: Number(data.get('quota')),
                            });
                            await refresh();
                            setNotice(
                              'Mailbox created. Its password is not stored in your browser.',
                            );
                          })
                        }
                      >
                        <Field label={`Address before @${domain.name}`} name="address" />
                        <Field label="Mailbox display name" name="name" />
                        <Field
                          label="Mailbox password"
                          name="password"
                          type="password"
                          autoComplete="new-password"
                          minLength={14}
                        />
                        <Field
                          label="Storage allowance (MiB)"
                          name="quota"
                          type="number"
                          defaultValue="1024"
                        />
                        <button disabled={busy}>Create mailbox</button>
                      </form>
                      {mailboxes.map((m) => (
                        <p key={m.email}>✓ {m.email}</p>
                      ))}
                      <button
                        disabled={busy || !domain.active || !status.host.available}
                        onClick={() => void run(() => task('webmail', 'webmail.' + domain.name))}
                      >
                        Set up secure customer webmail
                      </button>
                      <p>
                        Customer webmail needs its DNS record and a certificate. Mail clients use
                        the canonical server hostname, IMAPS 993 and SMTP STARTTLS 587.
                      </p>
                      <button className="secondary" onClick={() => setFirstStep(5)}>
                        Next: delivery test
                      </button>
                    </>
                  )}
                </section>
              )}
              {firstStep === 5 && (
                <section className="panel setup-card">
                  <h2>5. Verify receiving and sending</h2>
                  {!domain ? (
                    <p>Add a domain first.</p>
                  ) : (
                    <>
                      <Checks items={domain.readiness ?? []} />
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`/domains/${domain.id}/sending`, 'POST', { enabled: true });
                            await refresh();
                            setNotice('Sending enabled after readiness checks.');
                          })
                        }
                      >
                        Enable sending after checks pass
                      </button>
                      <p>
                        Use webmail to send between two local mailboxes and to an outside account.
                        Reply from the outside account. Inspect authentication and inbox/spam
                        placement; SMTP acceptance does not guarantee inbox delivery.
                      </p>
                      <form
                        onSubmit={(e) =>
                          submit(e, async (data) => {
                            if (data.get('local') !== 'on' || data.get('external') !== 'on')
                              throw new Error('Complete and confirm both delivery tests first.');
                            await api('/setup/complete', 'POST', {
                              receivedLocalTest: true,
                              testedExternalDelivery: true,
                            });
                            await refresh();
                            setNotice(
                              'Guided setup complete. Keep monitoring certificates, backups and delivery.',
                            );
                          })
                        }
                      >
                        <label className="setup-choice">
                          <input type="checkbox" name="local" required />I received the local
                          mailbox test.
                        </label>
                        <label className="setup-choice">
                          <input type="checkbox" name="external" required />I tested external
                          sending and receiving and reviewed inbox/spam placement.
                        </label>
                        <button disabled={busy || !domain.sendingEnabled}>
                          Finish guided setup
                        </button>
                      </form>
                      {status.setup?.completedAt && (
                        <p role="status">
                          ✓ Setup completed on{' '}
                          {new Date(status.setup.completedAt).toLocaleDateString('en-GB')}
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}
              <section className="panel setup-card">
                <h2>Keep your server healthy</h2>
                <h3>Certificates</h3>
                {status.host.certificates?.map((c) => (
                  <p key={c.hostname}>
                    {c.hostname}: {c.status === 'Action needed' ? 'Action needed — ' : ''}
                    {c.expiresAt ?? c.status}
                  </p>
                ))}
                <p>
                  Public certificates are renewed automatically. Renewal failures need attention
                  before certificates expire.
                </p>
                <h3>Encrypted off-server backup</h3>
                <p>
                  After saving, approve the destination in your server terminal with{' '}
                  <code>sudo /opt/nsoft-mail-companion/scripts/install.sh --approve-backup</code>.
                  This independent confirmation protects mail and private keys from being redirected
                  by a compromised web application.
                </p>
                <p>
                  {status.host.backupConfigured
                    ? 'Daily backup scheduling is configured. Perform and inspect a restore drill before relying on it.'
                    : 'Connect an S3-compatible off-server repository. Keep its encryption password in secure offline recovery storage.'}
                </p>
                <form
                  onSubmit={(e) =>
                    submit(e, async (data) => {
                      await api('/setup/backup', 'POST', {
                        repository: data.get('repository'),
                        password: data.get('backupPassword'),
                        accessKey: data.get('accessKey'),
                        secretKey: data.get('secretKey'),
                      });
                      await refresh();
                      setNotice(
                        'Backup settings proposed. Confirm this exact destination from the server terminal to enable scheduling.',
                      );
                    })
                  }
                >
                  <Field
                    label="Backup repository (s3:https://storage.example.com/bucket)"
                    name="repository"
                  />
                  <Field
                    label="Backup encryption password"
                    name="backupPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={20}
                  />
                  <Field
                    label="Storage access key"
                    name="accessKey"
                    type="password"
                    autoComplete="off"
                  />
                  <Field
                    label="Storage secret key"
                    name="secretKey"
                    type="password"
                    autoComplete="off"
                  />
                  <button disabled={busy || !status.host.available}>Save backup settings</button>
                </form>
                <div className="actions">
                  <button
                    disabled={busy || !status.host.backupConfigured}
                    onClick={() => void run(() => task('backup'))}
                  >
                    Run backup now
                  </button>
                  <button
                    disabled={busy || !status.host.backupConfigured}
                    onClick={() => void run(() => task('restore-check'))}
                  >
                    Check isolated restore
                  </button>
                </div>
                <p>
                  Backup briefly pauses mail writers. Archive restoration is isolated; a complete
                  database/mail recovery drill remains an administrator procedure.
                </p>
                <h3>Updates</h3>
                <p>
                  {status.host.update?.policy ??
                    'Install reviewed updates after a verified backup.'}
                </p>
                <code className="setup-revision">{status.host.update?.installedRevision}</code>
                <h3>Server action progress</h3>
                {status.tasks.length ? (
                  status.tasks.map((t) => (
                    <div className="row" key={t.id}>
                      <div>
                        <strong>{t.operation}</strong>
                        <small>{t.lastError}</small>
                      </div>
                      <span>
                        {t.status === 'SUCCEEDED'
                          ? 'Complete'
                          : t.status === 'FAILED'
                            ? 'Action needed'
                            : t.status.toLowerCase()}
                      </span>
                      {t.status === 'FAILED' && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api(`/setup/tasks/${t.id}/retry`, 'POST', {});
                              await refresh();
                            })
                          }
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p>No pending server actions.</p>
                )}
              </section>
            </>
          )}
        </>
      )}
      <footer>© 2026 M Suthakaran, trading as NSoft Academy · Apache-2.0</footer>
    </main>
  );
}
function Field(props: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  defaultValue?: string;
}) {
  return (
    <label>
      {props.label}
      <input
        name={props.name}
        type={props.type ?? 'text'}
        required={props.required !== false}
        autoComplete={props.autoComplete}
        minLength={props.minLength}
        defaultValue={props.defaultValue}
      />
    </label>
  );
}
function Checks({ items }: { items: Check[] }) {
  return (
    <ul className="setup-checks">
      {items.map((c) => (
        <li key={c.name}>
          <strong>
            {c.passed ? '✓ Complete' : '! Action needed'} · {c.name.replaceAll('-', ' ')}
          </strong>
          <p>{c.detail}</p>
        </li>
      ))}
    </ul>
  );
}
