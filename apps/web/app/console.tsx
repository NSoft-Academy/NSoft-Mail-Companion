// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string | null;
  csrfToken: string;
  mfaEnabled: boolean;
};
type Domain = {
  id: string;
  name: string;
  tenantId: string;
  active: boolean;
  sendingEnabled: boolean;
  verifiedAt: string | null;
  dkimPublicKey: string | null;
  readiness: { name: string; passed: boolean; detail: string }[] | null;
};
type Tenant = { id: string; name: string };
type Mailbox = {
  id: string;
  email: string;
  name: string;
  quotaMb: number;
  active: boolean;
  usedBytes: string;
};
type Alias = { id: string; source: string; destinations: string[] };
type RecordItem = { type: string; name: string; value: string; purpose: string; priority?: number };
type Job = { id: string; kind: string; status: string; attempts: number; lastError: string | null };
type Audit = { id: string; action: string; createdAt: string; entityId: string | null };
type Admin = { id: string; name: string; email: string; active: boolean; role: string };
type Summary = { domains: number; mailboxes: number; ready: number; failedJobs: number };
const sections = [
  'Overview',
  'Domains',
  'Mailboxes',
  'Aliases',
  'Delivery checks',
  'Activity',
  'Administration',
  'Settings',
];
function Field({
  label,
  name,
  type = 'text',
  required = true,
  children,
  ...props
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  children?: ReactNode;
  placeholder?: string;
  min?: number;
  defaultValue?: string | number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children ?? <input name={name} type={type} required={required} {...props} />}
    </label>
  );
}
function Status({ good, children }: { good: boolean; children: ReactNode }) {
  return (
    <span className={`badge ${good ? 'good' : 'pending'}`}>
      <i />
      {children}
    </span>
  );
}
export function Console() {
  const [user, setUser] = useState<User | null>(null),
    [initial, setInitial] = useState(true),
    [section, setSection] = useState('Overview'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [domains, setDomains] = useState<Domain[]>([]),
    [tenants, setTenants] = useState<Tenant[]>([]),
    [selected, setSelected] = useState(''),
    [mailboxes, setMailboxes] = useState<Mailbox[]>([]),
    [aliases, setAliases] = useState<Alias[]>([]),
    [records, setRecords] = useState<RecordItem[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [audits, setAudits] = useState<Audit[]>([]),
    [admins, setAdmins] = useState<Admin[]>([]),
    [settings, setSettings] = useState<{
      hostname: string;
      ipv4: string;
      delivery: string;
      cloudflare: boolean;
    } | null>(null),
    [summary, setSummary] = useState<Summary>({
      domains: 0,
      mailboxes: 0,
      ready: 0,
      failedJobs: 0,
    }),
    [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null),
    [menu, setMenu] = useState(false),
    [cloudPreview, setCloudPreview] = useState<{
      suggested: RecordItem[];
      current: unknown;
    } | null>(null);
  const domain = domains.find((d) => d.id === selected);
  async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { 'X-CSRF-Token': user.csrfToken } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message ?? 'The request could not be completed.');
    return json.data as T;
  }
  useEffect(() => {
    fetch('/api/v1/auth/me', { cache: 'no-store' })
      .then(async (response) => {
        if (response.ok) setUser((await response.json()).data);
      })
      .catch(() => setError('Cannot connect to the API. Check the service health.'))
      .finally(() => setInitial(false));
  }, []);
  async function refresh() {
    if (!user?.mfaEnabled) return;
    const [list, overview] = await Promise.all([
      api<Domain[]>('/domains'),
      api<Summary>('/overview'),
    ]);
    setDomains(list);
    setSummary(overview);
    if (!selected && list[0]) setSelected(list[0].id);
    if (user.role === 'PLATFORM_ADMIN') setTenants(await api<Tenant[]>('/tenants'));
  }
  useEffect(() => {
    if (user?.mfaEnabled) void refresh().catch((e) => setError(e.message));
  }, [user?.id, user?.mfaEnabled]);
  useEffect(() => {
    if (!user?.mfaEnabled) return;
    const load = async () => {
      if (selected) {
        const [boxes, forwarding, dns] = await Promise.all([
          api<Mailbox[]>(`/domains/${selected}/mailboxes`),
          api<Alias[]>(`/domains/${selected}/aliases`),
          api<RecordItem[]>(`/domains/${selected}/dns`),
        ]);
        setMailboxes(boxes);
        setAliases(forwarding);
        setRecords(dns);
      }
      if (section === 'Activity') {
        setJobs(await api<Job[]>('/jobs'));
        setAudits(await api<Audit[]>('/audit'));
      }
      if (section === 'Administration' && user.role === 'PLATFORM_ADMIN')
        setAdmins(await api<Admin[]>('/users'));
      if (section === 'Settings' && user.role === 'PLATFORM_ADMIN')
        setSettings(await api('/settings'));
    };
    void load().catch((e) => setError(e.message));
  }, [selected, section, user?.mfaEnabled]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);
  async function run(action: () => Promise<void>) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error.');
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, method: string, body: unknown, message: string) {
    await api(path, method, body);
    await refresh();
    if (selected) {
      setMailboxes(await api(`/domains/${selected}/mailboxes`));
      setAliases(await api(`/domains/${selected}/aliases`));
    }
    setNotice(message);
  }
  function submit(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<void>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    void run(async () => {
      await action(data);
      form.reset();
    });
  }
  const alerts = (
    <>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert" role="status">
          {notice}
        </div>
      )}
    </>
  );
  if (initial)
    return (
      <main id="main" className="login">
        <p role="status">Connecting to your mail companion…</p>
      </main>
    );
  if (!user)
    return (
      <main id="main" className="login">
        <div className="login-story">
          <Brand />
          <div className="eyebrow">YOUR SERVER. YOUR MAIL.</div>
          <h1>
            A home for
            <br />
            every inbox.
          </h1>
          <p>Open-source mail hosting, built to live alongside your applications.</p>
          <div className="story-line">
            Independent infrastructure <span>✦</span> Powered by NSoft Academy
          </div>
        </div>
        <section className="login-card">
          <span className="eyebrow">CONTROL PANEL</span>
          <h2>Welcome back</h2>
          <p>Sign in to manage your domains and mailboxes.</p>
          {alerts}
          <form
            onSubmit={(e) =>
              submit(e, async (data) => {
                await api('/auth/login', 'POST', {
                  email: data.get('email'),
                  password: data.get('password'),
                  ...(data.get('code') ? { code: data.get('code') } : {}),
                });
                setUser(await api('/auth/me'));
              })
            }
          >
            <Field label="Email address" name="email" type="email" />
            <Field label="Password" name="password" type="password" />
            <Field label="Authenticator code (if enabled)" name="code" required={false} />
            <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button>
          </form>
          <p className="muted">
            First installation? Create an administrator using the bootstrap CLI.
          </p>
          <small>© 2026 M Suthakaran, trading as NSoft Academy.</small>
        </section>
      </main>
    );
  if (!user.mfaEnabled)
    return (
      <main id="main" className="login">
        <section className="login-card">
          <Brand />
          <h1>Secure your account</h1>
          <p>Administrator MFA is required before managing mail.</p>
          {alerts}
          {!enrollment ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => setEnrollment(await api('/auth/mfa/enroll', 'POST', {})))
              }
            >
              Set up an authenticator
            </button>
          ) : (
            <>
              <p>Add this key to your authenticator app:</p>
              <code className="secret">{enrollment.secret}</code>
              <form
                onSubmit={(e) =>
                  submit(e, async (data) => {
                    await api('/auth/mfa/confirm', 'POST', { code: data.get('code') });
                    setUser(await api('/auth/me'));
                    setEnrollment(null);
                  })
                }
              >
                <Field label="Six-digit authenticator code" name="code" />
                <button disabled={busy}>Verify and continue</button>
              </form>
            </>
          )}
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                await api('/auth/logout', 'POST', {});
                setUser(null);
              })
            }
          >
            Sign out
          </button>
        </section>
      </main>
    );
  return (
    <div className="shell">
      <aside className={menu ? 'sidebar open' : 'sidebar'}>
        <Brand />
        <p className="sidebar-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {sections
            .filter(
              (s) => user.role === 'PLATFORM_ADMIN' || !['Administration', 'Settings'].includes(s),
            )
            .map((s, i) => (
              <button
                key={s}
                className={section === s ? 'nav active' : 'nav'}
                aria-current={section === s ? 'page' : undefined}
                onClick={() => {
                  setSection(s);
                  setMenu(false);
                }}
              >
                <span className="nav-icon" aria-hidden="true">
                  {['◈', '◎', '▣', '↗', '✓', '◷', '◇', '⚙'][i]}
                </span>
                {s}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Status good>Self-hosted</Status>
          <p>
            Your infrastructure.
            <br />
            No paid mailbox limits.
          </p>
          <small>Apache-2.0 · NSoft Academy</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-toggle secondary"
            aria-expanded={menu}
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            ☰
          </button>
          <span>
            Mail workspace <span className="slash">/</span> <strong>{section}</strong>
          </span>
          <div className="user">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <span>
              {user.name}
              <small>
                {user.role === 'PLATFORM_ADMIN' ? 'Platform administrator' : 'Domain administrator'}
              </small>
            </span>
            <button
              className="secondary compact"
              onClick={() =>
                void run(async () => {
                  await api('/auth/logout', 'POST', {});
                  setUser(null);
                })
              }
            >
              Sign out
            </button>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">NSOFT MAIL COMPANION</div>
              <h1>{section === 'Overview' ? 'Your mail, at a glance.' : section}</h1>
              <p>
                {section === 'Overview'
                  ? 'A clear view of the domains and inboxes you manage.'
                  : 'Manage your mail infrastructure with confidence.'}
              </p>
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await refresh();
                  if (section === 'Activity') {
                    setJobs(await api('/jobs'));
                    setAudits(await api('/audit'));
                  }
                  setNotice('Workspace refreshed.');
                })
              }
            >
              ↻ Refresh
            </button>
          </div>
          {alerts}
          {section === 'Overview' && (
            <>
              <div className="stats">
                {[
                  ['Domains', summary.domains, 'Verified ownership before activation'],
                  ['Mailboxes', summary.mailboxes, 'Persistent, quota-controlled storage'],
                  ['Sending enabled', summary.ready, 'Domain readiness checks passed'],
                  ['Failed jobs', summary.failedJobs, 'Review provisioning in Activity'],
                ].map(([label, value, description]) => (
                  <article className="stat" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{description}</small>
                  </article>
                ))}
              </div>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Domain workspace</h2>
                    <button className="text-button" onClick={() => setSection('Domains')}>
                      Manage domains →
                    </button>
                  </div>
                  {domains.length === 0 ? (
                    <Empty
                      title="Your first domain starts here"
                      detail="Add a domain, publish its ownership record, and run the setup checks."
                      action={<button onClick={() => setSection('Domains')}>Add a domain →</button>}
                    />
                  ) : (
                    domains.slice(0, 6).map((d) => (
                      <div className="row" key={d.id}>
                        <div>
                          <strong>{d.name}</strong>
                          <small>
                            {d.verifiedAt ? 'Ownership verified' : 'Awaiting DNS verification'}
                          </small>
                        </div>
                        <Status good={d.sendingEnabled}>
                          {d.sendingEnabled ? 'Sending enabled' : 'Setup pending'}
                        </Status>
                      </div>
                    ))
                  )}
                </section>
                <section className="panel accent">
                  <span className="eyebrow">DELIVERY, WITH CLARITY</span>
                  <h2>
                    Good mail starts
                    <br />
                    with good setup.
                  </h2>
                  <p>
                    Verify DNS, authentication, and TLS before enabling sending. Receiving providers
                    decide inbox placement.
                  </p>
                  <button className="secondary" onClick={() => setSection('Delivery checks')}>
                    Review delivery checks →
                  </button>
                  <div className="check-list">
                    ✓ SPF and DKIM
                    <br />✓ Domain ownership
                    <br />✓ Reverse DNS and TLS
                  </div>
                </section>
              </div>
              <section className="panel">
                <h2>A companion to your platform</h2>
                <p>
                  Run alongside Coolify or standalone Docker. Domain administrators only see their
                  own workspace. Mail survives application deployments.
                </p>
              </section>
            </>
          )}
          {section === 'Domains' && (
            <div className="split">
              <section className="panel">
                <h2>Your domains</h2>
                {domains.length === 0 ? (
                  <Empty
                    title="No domains yet"
                    detail="Create a tenant, then add its first domain."
                  />
                ) : (
                  domains.map((d) => (
                    <div className="row" key={d.id}>
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelected(d.id);
                          setSection('Delivery checks');
                        }}
                      >
                        {d.name}
                      </button>
                      <Status good={d.active}>{d.active ? 'Active' : 'Inactive'}</Status>
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (
                              !window.confirm(
                                `${d.active ? 'Suspend' : 'Activate'} ${d.name}? Suspension disables receiving and sending.`,
                              )
                            )
                              return;
                            await mutate(
                              `/domains/${d.id}`,
                              'PATCH',
                              { active: !d.active },
                              'Domain status updated.',
                            );
                          })
                        }
                      >
                        {d.active ? 'Suspend' : 'Activate'}
                      </button>
                    </div>
                  ))
                )}
              </section>
              <section className="panel">
                <h2>Add a domain</h2>
                <form
                  onSubmit={(e) =>
                    submit(e, async (data) => {
                      const created = await api<Domain>('/domains', 'POST', {
                        name: data.get('name'),
                        quotaMb: Number(data.get('quotaMb')),
                        ...(user.role === 'PLATFORM_ADMIN'
                          ? { tenantId: data.get('tenantId') }
                          : {}),
                      });
                      setSelected(created.id);
                      await refresh();
                      setNotice('Domain added. Publish its DNS records and run checks.');
                    })
                  }
                >
                  <Field label="Domain name" name="name" placeholder="example.com" />
                  {user.role === 'PLATFORM_ADMIN' && (
                    <Field label="Tenant" name="tenantId">
                      <select name="tenantId" required>
                        <option value="">Choose a tenant</option>
                        {tenants.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field
                    label="Total mailbox allocation (MiB)"
                    name="quotaMb"
                    type="number"
                    min={1}
                    defaultValue={10240}
                  />
                  <button disabled={busy}>Add domain →</button>
                </form>
              </section>
            </div>
          )}
          {['Mailboxes', 'Aliases', 'Delivery checks'].includes(section) && (
            <>
              <label className="domain-picker">
                Domain
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  <option value="">Choose a domain</option>
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              {!domain ? (
                <Empty
                  title="Select a domain"
                  detail="Add or select a domain to manage its mail."
                />
              ) : (
                <>
                  {section === 'Mailboxes' && (
                    <div className="split">
                      <section className="panel">
                        <h2>Mailboxes</h2>
                        {mailboxes.length === 0 ? (
                          <Empty
                            title="No mailboxes yet"
                            detail="Verify the domain before creating an inbox."
                          />
                        ) : (
                          mailboxes.map((m) => (
                            <div className="row" key={m.id}>
                              <div>
                                <strong>{m.email}</strong>
                                <small>
                                  {m.name} · {m.quotaMb} MiB allocation ·{' '}
                                  {(Number(m.usedBytes) / 1048576).toFixed(1)} MiB used
                                </small>
                              </div>
                              <button
                                className="secondary compact"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () =>
                                    mutate(
                                      `/mailboxes/${m.id}`,
                                      'PATCH',
                                      { active: !m.active },
                                      'Mailbox status updated.',
                                    ),
                                  )
                                }
                              >
                                {m.active ? 'Suspend' : 'Activate'}
                              </button>
                              <button
                                className="secondary compact"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const secret = window.prompt(
                                      'Enter a new password (14+ characters, uppercase, lowercase and number).',
                                    );
                                    if (secret)
                                      await mutate(
                                        `/mailboxes/${m.id}`,
                                        'PATCH',
                                        { password: secret },
                                        'Mailbox password reset.',
                                      );
                                  })
                                }
                              >
                                Reset password
                              </button>
                            </div>
                          ))
                        )}
                      </section>
                      <section className="panel">
                        <h2>Create an inbox</h2>
                        <form
                          onSubmit={(e) =>
                            submit(e, async (data) =>
                              mutate(
                                `/domains/${selected}/mailboxes`,
                                'POST',
                                {
                                  localPart: data.get('localPart'),
                                  name: data.get('name'),
                                  password: data.get('password'),
                                  quotaMb: Number(data.get('quotaMb')),
                                },
                                'Mailbox created.',
                              ),
                            )
                          }
                        >
                          <Field label={`Address before @${domain.name}`} name="localPart" />
                          <Field label="Display name" name="name" />
                          <Field
                            label="Password (14+ characters, uppercase, lowercase and number)"
                            name="password"
                            type="password"
                          />
                          <Field
                            label="Quota (MiB)"
                            name="quotaMb"
                            type="number"
                            min={1}
                            defaultValue={1024}
                          />
                          <button disabled={busy || !domain.active}>Create mailbox →</button>
                        </form>
                        <a
                          className="external"
                          href={`https://webmail.${domain.name}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open customer webmail ↗
                        </a>
                        <p className="muted">
                          Log in using the full email address. Route this HTTPS hostname in Coolify
                          first.
                        </p>
                      </section>
                    </div>
                  )}
                  {section === 'Aliases' && (
                    <div className="split">
                      <section className="panel">
                        <h2>Address aliases</h2>
                        {aliases.length === 0 ? (
                          <Empty
                            title="No aliases"
                            detail="Give an existing inbox another address."
                          />
                        ) : (
                          aliases.map((a) => (
                            <div className="row" key={a.id}>
                              <div>
                                <strong>{a.source}</strong>
                                <small>→ {a.destinations.join(', ')}</small>
                              </div>
                              <button
                                className="secondary compact"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    if (window.confirm(`Remove ${a.source}?`))
                                      await mutate(
                                        `/aliases/${a.id}`,
                                        'DELETE',
                                        undefined,
                                        'Alias removed.',
                                      );
                                  })
                                }
                              >
                                Remove
                              </button>
                            </div>
                          ))
                        )}
                      </section>
                      <section className="panel">
                        <h2>Add an alias</h2>
                        <form
                          onSubmit={(e) =>
                            submit(e, async (data) =>
                              mutate(
                                `/domains/${selected}/aliases`,
                                'POST',
                                {
                                  localPart: data.get('localPart'),
                                  destinations: String(data.get('destinations'))
                                    .split(',')
                                    .map((v) => v.trim()),
                                },
                                'Alias created.',
                              ),
                            )
                          }
                        >
                          <Field label="Alias address (use * for catch-all)" name="localPart" />
                          <Field
                            label="Existing mailbox addresses, comma-separated"
                            name="destinations"
                          />
                          <p className="muted">
                            Forwarding is limited to active inboxes in this domain. External
                            forwarding is disabled.
                          </p>
                          <button disabled={busy || !domain.active}>Create alias</button>
                        </form>
                      </section>
                    </div>
                  )}
                  {section === 'Delivery checks' && (
                    <>
                      <section className="panel">
                        <div className="panel-heading">
                          <div>
                            <h2>Delivery readiness</h2>
                            <p>Checks measure setup readiness, not guaranteed inbox placement.</p>
                          </div>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api(`/domains/${selected}/check`, 'POST', {});
                                setNotice('Checks queued. Refresh shortly to view results.');
                              })
                            }
                          >
                            Run checks →
                          </button>
                        </div>
                        {domain.readiness ? (
                          domain.readiness.map((c) => (
                            <div className="row" key={c.name}>
                              <div>
                                <strong className="capitalise">{c.name}</strong>
                                <small>{c.detail}</small>
                              </div>
                              <Status good={c.passed}>
                                {c.passed ? 'Passed' : 'Needs attention'}
                              </Status>
                            </div>
                          ))
                        ) : (
                          <Empty
                            title="Ready when you are"
                            detail="Publish the records below, then run delivery checks."
                          />
                        )}
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () =>
                              mutate(
                                `/domains/${selected}/sending`,
                                'POST',
                                { enabled: !domain.sendingEnabled },
                                'Sending setting updated.',
                              ),
                            )
                          }
                        >
                          {domain.sendingEnabled
                            ? 'Disable sending'
                            : 'Enable sending after checks'}
                        </button>
                      </section>
                      <section className="panel">
                        <h2>DNS setup</h2>
                        <p>
                          Review existing MX and SPF before making changes. Set reverse DNS through
                          your IP provider.
                        </p>
                        {records.map((r) => (
                          <div className="dns-record" key={r.name + r.type}>
                            <span className="badge">{r.type}</span>
                            <div>
                              <strong>{r.name}</strong>
                              <code>
                                {r.priority ? `${r.priority} ` : ''}
                                {r.value}
                              </code>
                              <small>{r.purpose}</small>
                            </div>
                          </div>
                        ))}
                      </section>
                      {user.role === 'PLATFORM_ADMIN' && (
                        <section className="panel">
                          <h2>Optional Cloudflare setup</h2>
                          <form
                            onSubmit={(e) =>
                              submit(e, async (data) => {
                                setCloudPreview(
                                  await api(`/domains/${selected}/cloudflare/preview`, 'POST', {
                                    zoneId: data.get('zoneId'),
                                  }),
                                );
                                setNotice(
                                  'Preview loaded. Review current records before applying.',
                                );
                              })
                            }
                          >
                            <Field label="Cloudflare zone ID" name="zoneId" />
                            <button className="secondary" disabled={busy}>
                              Preview records
                            </button>
                          </form>
                          {cloudPreview && (
                            <>
                              <pre className="preview">{JSON.stringify(cloudPreview, null, 2)}</pre>
                              <form
                                onSubmit={(e) =>
                                  submit(e, async (data) => {
                                    if (
                                      !window.confirm(
                                        'Create selected DNS records? Existing records will never be overwritten.',
                                      )
                                    )
                                      return;
                                    await api(`/domains/${selected}/cloudflare/apply`, 'POST', {
                                      zoneId: data.get('zoneId'),
                                      records: String(data.get('indices')).split(',').map(Number),
                                      confirmed: true,
                                    });
                                    setCloudPreview(null);
                                    setNotice('DNS records created.');
                                  })
                                }
                              >
                                <Field label="Confirm zone ID" name="zoneId" />
                                <Field
                                  label="Record indices to create (0–5, comma-separated)"
                                  name="indices"
                                />
                                <button disabled={busy}>Apply selected records</button>
                              </form>
                            </>
                          )}
                        </section>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
          {section === 'Activity' && (
            <div className="split">
              <section className="panel">
                <h2>Provisioning jobs</h2>
                {jobs.length === 0 ? (
                  <Empty title="No jobs yet" detail="Domain setup creates jobs automatically." />
                ) : (
                  jobs.map((j) => (
                    <div className="row" key={j.id}>
                      <div>
                        <strong>{j.kind.replaceAll('_', ' ')}</strong>
                        <small>
                          Attempt {j.attempts}
                          {j.lastError ? ` · ${j.lastError}` : ''}
                        </small>
                      </div>
                      <div className="actions">
                        <Status good={j.status === 'SUCCEEDED'}>{j.status}</Status>
                        {j.status === 'FAILED' && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api(`/jobs/${j.id}/retry`, 'POST', {});
                                setJobs(await api<Job[]>('/jobs'));
                                setNotice('Provisioning retry queued.');
                              })
                            }
                          >
                            Retry job
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </section>
              <section className="panel">
                <h2>Audit trail</h2>
                {audits.length === 0 ? (
                  <Empty title="No activity yet" detail="Privileged actions appear here." />
                ) : (
                  audits.map((a) => (
                    <div className="row" key={a.id}>
                      <div>
                        <strong>{a.action}</strong>
                        <small>{new Date(a.createdAt).toLocaleString('en-GB')}</small>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </div>
          )}
          {section === 'Administration' && (
            <div className="split">
              <section className="panel">
                <h2>Create a tenant</h2>
                <form
                  onSubmit={(e) =>
                    submit(e, async (data) => {
                      await api('/tenants', 'POST', { name: data.get('name') });
                      await refresh();
                      setNotice('Tenant created.');
                    })
                  }
                >
                  <Field label="Organisation name" name="name" />
                  <button disabled={busy}>Create tenant</button>
                </form>
                <h2 className="spaced">Domain administrators</h2>
                {admins.map((a) => (
                  <div className="row" key={a.id}>
                    <div>
                      <strong>{a.email}</strong>
                      <small>{a.role}</small>
                    </div>
                    {a.role !== 'PLATFORM_ADMIN' && (
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`/users/${a.id}`, 'PATCH', { active: !a.active });
                            setAdmins(await api('/users'));
                          })
                        }
                      >
                        {a.active ? 'Suspend' : 'Activate'}
                      </button>
                    )}
                  </div>
                ))}
              </section>
              <section className="panel">
                <h2>Invite an administrator</h2>
                <p>
                  Set an initial password and deliver it through a secure channel. MFA enrollment is
                  required.
                </p>
                <form
                  onSubmit={(e) =>
                    submit(e, async (data) => {
                      await api('/users', 'POST', {
                        name: data.get('name'),
                        email: data.get('email'),
                        password: data.get('password'),
                        tenantId: data.get('tenantId'),
                      });
                      setAdmins(await api('/users'));
                      setNotice('Administrator created.');
                    })
                  }
                >
                  <Field label="Name" name="name" />
                  <Field label="Email" name="email" type="email" />
                  <Field label="Initial password" name="password" type="password" />
                  <Field label="Tenant" name="tenantId">
                    <select name="tenantId" required>
                      <option value="">Choose a tenant</option>
                      {tenants.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button disabled={busy}>Create administrator</button>
                </form>
              </section>
            </div>
          )}
          {section === 'Settings' && (
            <section className="panel">
              <h2>Server configuration</h2>
              {settings ? (
                <>
                  <div className="row">
                    <strong>Canonical hostname</strong>
                    <code>{settings.hostname}</code>
                  </div>
                  <div className="row">
                    <strong>Public IPv4</strong>
                    <code>{settings.ipv4}</code>
                  </div>
                  <div className="row">
                    <strong>Outbound route</strong>
                    <Status good>{settings.delivery}</Status>
                  </div>
                  <div className="row">
                    <strong>Cloudflare automation</strong>
                    <span>{settings.cloudflare ? 'Configured' : 'Manual DNS available'}</span>
                  </div>
                </>
              ) : (
                <p role="status">Loading configuration…</p>
              )}
              <p className="muted">
                Manage secrets and relay configuration through deployment environment variables.
                Backups and recovery are documented in the operations guide.
              </p>
            </section>
          )}
          <footer>
            NSoft Mail Companion{' '}
            <span>© 2026 M Suthakaran, trading as NSoft Academy · Apache-2.0</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        n<span>↗</span>
      </span>
      <div>
        NSoft <strong>Mail Companion</strong>
        <small>BY NSOFT ACADEMY</small>
      </div>
    </div>
  );
}
function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        ✉
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
