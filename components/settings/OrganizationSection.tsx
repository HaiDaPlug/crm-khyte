'use client'

import { type ReactNode, useId, useState } from 'react'
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  User,
  UserMinus,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react'

import { logout } from '@/app/actions/auth'
import {
  addMember,
  resetMemberPassword,
  revokeMember,
  updateMember,
  type MemberActionError,
  type MemberResult,
} from '@/app/actions/members'
import { Button } from '@/components/crm/Button'
import { ConfirmDialog } from '@/components/crm/ConfirmDialog'
import { AssigneePicker, Field, inputClass } from '@/components/crm/FormFields'
import { Modal } from '@/components/crm/Modal'
import { MemberAvatar } from '@/components/layout/AppSidebar'
import { colleagues } from '@/lib/colleagues'
import { useTranslations } from '@/lib/hooks/useTranslations'
import type { Dictionary } from '@/lib/i18n/translations'
import { useCRMStore } from '@/lib/store'
import type { ColleagueId, MemberRole, OrganizationMember } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The organization's roster, and what an owner can do to it.
 *
 * Reads the workspace the snapshot carried rather than fetching: the roster
 * is small, arrives with everything else, and a change reaches every open
 * browser through the same poll as the rest of the data (the change-stamp
 * covers organization_members). Writes go through app/actions/members —
 * owner-only and organization-pinned on the server — and the row an action
 * returns is filed straight into the store, so the list is right the moment
 * the action settles.
 *
 * Nothing here is optimistic. A member action is a round-trip to the account
 * service as well as the database, and the honest thing while it runs is a
 * disabled control, not a row that may have to be taken back.
 *
 * A temporary password lives in React state for exactly as long as its
 * dialog is open, and nowhere else — not the store, not storage, not a log.
 * It is shown once; handing it over is the owner's job.
 */

type Copy = Dictionary['organization']

type MemberValues = {
  email: string
  displayName: string
  role: MemberRole
  colleague: ColleagueId | null
}

type Dialog =
  | { kind: 'add'; prefill?: OrganizationMember }
  | { kind: 'edit'; member: OrganizationMember }
  | { kind: 'revoke'; member: OrganizationMember }
  | { kind: 'reset'; member: OrganizationMember }
  | { kind: 'password'; member: OrganizationMember; password: string }

/**
 * The order lib/org/members.listMembers returns: active before revoked,
 * owners before members, then by when they joined. Re-applied here so a row
 * that was just revoked or promoted settles into place at once rather than
 * on the next poll.
 */
function rosterOrder(a: OrganizationMember, b: OrganizationMember): number {
  if (a.status !== b.status) return a.status === 'active' ? -1 : 1
  if (a.role !== b.role) return a.role === 'owner' ? -1 : 1
  return a.createdAt.localeCompare(b.createdAt)
}

export function OrganizationSection() {
  const { t } = useTranslations()
  const copy = t.organization
  const workspace = useCRMStore((s) => s.workspace)
  const upsertWorkspaceMember = useCRMStore((s) => s.upsertWorkspaceMember)
  const markIdentityChanged = useCRMStore((s) => s.markIdentityChanged)

  const { organization, viewer } = workspace
  const isOwner = viewer.role === 'owner'
  // Sent with every member action and compared with the session server-side:
  // a dialog opened here and submitted after another tab logged in as
  // someone else is refused rather than saved into the new workspace. An
  // expectation to verify, never an authority.
  const scope = { organizationId: organization.id, userId: viewer.userId }
  const members = [...workspace.members].sort(rosterOrder)
  const activeCount = members.filter((m) => m.status === 'active').length

  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MemberActionError | null>(null)

  // A stale error under a fresh dialog would read as that dialog's fault.
  const showDialog = (next: Dialog | null) => {
    setError(null)
    setDialog(next)
  }

  /**
   * Runs one member action and files what it returns. Gives back the success,
   * or null after recording the failure — the caller decides what to show.
   */
  async function perform(run: () => Promise<MemberResult>) {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      if (!result.ok) {
        // The server answered as someone else: this tab's session is gone.
        // Nothing the server returned may be filed here, and no further
        // action may be sent — the store is finished and SnapshotSync
        // reloads the page. Same move the CRM store makes in persist().
        if (result.error === 'context_mismatch') {
          markIdentityChanged()
          return null
        }
        setError(result.error)
        return null
      }
      upsertWorkspaceMember(result.member)
      return result
    } catch (cause) {
      // The action never throws — it returns a code — so this is transport:
      // offline, or the gate turning the POST away because this session has
      // ended. The next navigation sorts the latter out.
      console.error('[khyte] member action failed:', cause instanceof Error ? cause.message : String(cause))
      setError('failed')
      return null
    } finally {
      setBusy(false)
    }
  }

  const handleAdd = async (values: MemberValues) => {
    const result = await perform(() => addMember(values, scope))
    if (!result) return
    // A brand-new account comes back with the password it was created with;
    // an existing account merely added to the roster does not, and the new
    // row appearing is confirmation enough.
    if (result.temporaryPassword) {
      showDialog({ kind: 'password', member: result.member, password: result.temporaryPassword })
    } else {
      showDialog(null)
    }
  }

  const handleEdit = async (memberId: string, values: MemberValues) => {
    const result = await perform(() =>
      updateMember(
        {
          memberId,
          displayName: values.displayName,
          role: values.role,
          colleague: values.colleague,
        },
        scope
      )
    )
    if (result) showDialog(null)
  }

  const handleRevoke = async (member: OrganizationMember) => {
    showDialog(null)
    const result = await perform(() => revokeMember({ memberId: member.id }, scope))
    // Revoking yourself has already ended this session on the server. logout
    // clears the cookie and lands on the gate, instead of leaving a CRM on
    // screen whose every next request will be turned away.
    if (result && member.userId === viewer.userId) await logout()
  }

  const handleReset = async (member: OrganizationMember) => {
    showDialog(null)
    const result = await perform(() => resetMemberPassword({ memberId: member.id }, scope))
    if (result?.temporaryPassword) {
      showDialog({ kind: 'password', member: result.member, password: result.temporaryPassword })
    }
  }

  const formOpen = dialog?.kind === 'add' || dialog?.kind === 'edit'

  return (
    <section className="mb-6 sm:mb-7">
      {/* The caption is the organization's own name — this section is about
          a specific workspace, not about "organizations". */}
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="label-mono truncate">{organization.name}</h3>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-muted">{copy.memberCount(activeCount)}</p>
        </div>
        {isOwner ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => showDialog({ kind: 'add' })}
            disabled={busy}
            className="shrink-0"
          >
            <UserPlus size={14} />
            {copy.addMember}
          </Button>
        ) : (
          <p className="shrink-0 text-right text-[13px] text-foreground/60">{copy.readOnlyHint}</p>
        )}
      </div>

      <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border bg-surface">
        {/* Failures of the row actions land here; a form's own failure shows
            inside the form, where the person is looking. */}
        {error && !formOpen && (
          <div
            role="alert"
            className="flex items-start gap-2.5 bg-danger-muted px-4 py-3 text-[13.5px] text-danger sm:px-5"
          >
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{copy.errors[error]}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label={t.common.dismiss}
              className="-my-2 -mr-2 flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-lg transition-colors hover:bg-surface-raised"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isViewer={member.userId === viewer.userId}
            canManage={isOwner}
            busy={busy}
            copy={copy}
            onEdit={() => showDialog({ kind: 'edit', member })}
            onReset={() => showDialog({ kind: 'reset', member })}
            onRevoke={() => showDialog({ kind: 'revoke', member })}
            onReadd={() => showDialog({ kind: 'add', prefill: member })}
          />
        ))}
      </div>

      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <MemberModal
          // Mounted per dialog, so the form starts from its own initial values
          // and there is nothing to reset when it is reopened for someone else.
          key={dialog.kind === 'edit' ? dialog.member.id : `add:${dialog.prefill?.id ?? ''}`}
          mode={dialog.kind}
          initial={dialog.kind === 'edit' ? dialog.member : dialog.prefill}
          busy={busy}
          error={error}
          copy={copy}
          onClose={() => showDialog(null)}
          onSubmit={(values) => {
            if (dialog.kind === 'edit') void handleEdit(dialog.member.id, values)
            else void handleAdd(values)
          }}
        />
      )}

      <ConfirmDialog
        open={dialog?.kind === 'revoke'}
        title={dialog?.kind === 'revoke' ? copy.revokeDialog.title(dialog.member.displayName) : ''}
        description={
          dialog?.kind === 'revoke' && dialog.member.userId === viewer.userId
            ? copy.revokeDialog.selfDescription
            : copy.revokeDialog.description
        }
        confirmLabel={copy.revokeDialog.confirm}
        onConfirm={() => {
          if (dialog?.kind === 'revoke') void handleRevoke(dialog.member)
        }}
        onCancel={() => showDialog(null)}
      />

      {/* A reset is not destructive the way a revoke is, but it does lock the
          person out until the new password reaches them — worth a pause. */}
      <ConfirmDialog
        open={dialog?.kind === 'reset'}
        title={dialog?.kind === 'reset' ? copy.resetDialog.title(dialog.member.displayName) : ''}
        description={copy.resetDialog.description}
        confirmLabel={copy.resetDialog.confirm}
        onConfirm={() => {
          if (dialog?.kind === 'reset') void handleReset(dialog.member)
        }}
        onCancel={() => showDialog(null)}
      />

      {dialog?.kind === 'password' && (
        <PasswordModal
          member={dialog.member}
          password={dialog.password}
          copy={copy}
          onClose={() => showDialog(null)}
        />
      )}
    </section>
  )
}

/* ———— Rows ———— */

function Chip({ tone = 'default', children }: { tone?: 'default' | 'muted' | 'danger'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]',
        tone === 'danger' && 'border-danger/30 bg-danger-muted text-danger',
        tone === 'muted' && 'border-border-subtle text-muted',
        tone === 'default' && 'border-border-subtle text-foreground/70'
      )}
    >
      {children}
    </span>
  )
}

/** An icon-only row action: 44px on touch, the row's 36px on a desktop. */
function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg text-foreground/50 transition-colors sm:h-9 sm:w-9',
        'disabled:cursor-not-allowed disabled:opacity-40',
        danger ? 'hover:bg-danger-muted hover:text-danger' : 'hover:bg-surface-raised hover:text-foreground'
      )}
    >
      <Icon size={15} />
    </button>
  )
}

function MemberRow({
  member,
  isViewer,
  canManage,
  busy,
  copy,
  onEdit,
  onReset,
  onRevoke,
  onReadd,
}: {
  member: OrganizationMember
  isViewer: boolean
  canManage: boolean
  busy: boolean
  copy: Copy
  onEdit: () => void
  onReset: () => void
  onRevoke: () => void
  onReadd: () => void
}) {
  const revoked = member.status === 'revoked'
  const label = member.colleague ? colleagues[member.colleague] : null

  return (
    <div
      className={cn(
        'flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5',
        revoked && 'opacity-60'
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MemberAvatar name={member.displayName} colleague={member.colleague} className="size-9 text-[12px]" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-[15px] font-medium text-foreground">{member.displayName}</p>
            {isViewer && <span className="label-mono text-accent">{copy.you}</span>}
            <Chip>{copy.roles[member.role]}</Chip>
            {/* The roster label is a column in its own right — "—" says
                "nobody has mapped this person yet", not "nothing to show". */}
            {label ? (
              <Chip>
                <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: label.color }} />
                {label.name}
              </Chip>
            ) : (
              <Chip tone="muted">{copy.noColleague}</Chip>
            )}
            {revoked && <Chip tone="danger">{copy.revoked}</Chip>}
          </div>
          <p className="truncate text-[13px] text-foreground/60">{member.email}</p>
        </div>
      </div>

      {canManage && (
        <div className="flex items-center justify-end gap-0.5 sm:shrink-0">
          {revoked ? (
            // Re-adding reactivates the same membership (lib/org/members), so
            // the form opens prefilled with what the row already knows.
            <Button size="sm" variant="ghost" onClick={onReadd} disabled={busy} className="text-foreground/70">
              <UserPlus size={14} />
              {copy.readd}
            </Button>
          ) : (
            <>
              <IconAction label={copy.edit(member.displayName)} icon={Pencil} onClick={onEdit} disabled={busy} />
              <IconAction
                label={copy.resetPassword(member.displayName)}
                icon={KeyRound}
                onClick={onReset}
                disabled={busy}
              />
              <IconAction
                label={copy.revoke(member.displayName)}
                icon={UserMinus}
                onClick={onRevoke}
                disabled={busy}
                danger
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ———— Dialogs ———— */

/** Owner or member — the same pill row AssigneePicker draws, so the two
 *  choices in the form read as one control family. */
function RolePicker({
  value,
  onChange,
  label,
  roles,
}: {
  value: MemberRole
  onChange: (next: MemberRole) => void
  label: string
  roles: Record<MemberRole, string>
}) {
  const options: { role: MemberRole; icon: LucideIcon }[] = [
    { role: 'owner', icon: ShieldCheck },
    { role: 'member', icon: User },
  ]
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(({ role, icon: Icon }) => {
        const active = value === role
        return (
          <button
            key={role}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(role)}
            className={cn(
              'flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[13.5px] font-medium transition-all sm:h-8 sm:min-h-0',
              active
                ? 'border-border bg-surface-raised text-foreground'
                : 'border-border-subtle text-foreground/60 hover:border-border hover:text-foreground'
            )}
          >
            <Icon size={13} className={active ? 'text-accent' : undefined} />
            {roles[role]}
          </button>
        )
      })}
    </div>
  )
}

/** Good enough to stop a typo before the round-trip; zod on the server decides. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function MemberModal({
  mode,
  initial,
  busy,
  error,
  copy,
  onClose,
  onSubmit,
}: {
  mode: 'add' | 'edit'
  /** The member being edited, or a revoked one being added back. */
  initial?: OrganizationMember
  busy: boolean
  error: MemberActionError | null
  copy: Copy
  onClose: () => void
  onSubmit: (values: MemberValues) => void
}) {
  const { t } = useTranslations()
  const formId = useId()
  const form = copy.form
  const isEdit = mode === 'edit'

  const [email, setEmail] = useState(initial?.email ?? '')
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [role, setRole] = useState<MemberRole>(initial?.role ?? 'member')
  const [colleague, setColleague] = useState<ColleagueId | undefined>(initial?.colleague)

  const emailOk = isEdit || EMAIL_SHAPE.test(email.trim())
  const canSubmit = !busy && emailOk && displayName.trim().length > 0

  const submit = () => {
    if (!canSubmit) return
    onSubmit({
      email: email.trim().toLowerCase(),
      displayName: displayName.trim(),
      role,
      colleague: colleague ?? null,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? form.editTitle : form.addTitle}
      subtitle={isEdit ? form.editSubtitle : form.addSubtitle}
      width="w-[520px]"
      onSubmitShortcut={submit}
      footer={
        <>
          <span aria-hidden="true" />
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span className="hidden font-mono text-[12px] text-foreground opacity-60 sm:block">⌘↵</span>
            <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
              {t.common.cancel}
            </Button>
            <Button onClick={submit} disabled={!canSubmit} className="w-full sm:w-auto">
              {isEdit ? <Check size={14} /> : <UserPlus size={14} />}
              {busy ? form.saving : isEdit ? form.save : form.add}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4 px-4 py-4 sm:space-y-5 sm:px-6 sm:py-5">
        {isEdit ? (
          // The address belongs to the account, not the membership — shown so
          // the owner knows whose row this is, but not as a field.
          <Field label={form.email}>
            <p className="flex h-11 items-center font-mono text-[14px] text-foreground/70 sm:h-10">
              {initial?.email}
            </p>
          </Field>
        ) : (
          <Field label={form.email} required htmlFor={`${formId}-email`}>
            <input
              id={`${formId}-email`}
              type="email"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}

        <Field label={form.displayName} required htmlFor={`${formId}-name`}>
          <input
            id={`${formId}-name`}
            autoFocus={isEdit}
            autoComplete="off"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label={form.role}>
          <RolePicker value={role} onChange={setRole} label={form.role} roles={copy.roles} />
          <p className="mt-2 text-[13px] leading-snug text-foreground/60">{form.roleHint}</p>
        </Field>

        <Field label={form.colleague}>
          <AssigneePicker
            value={colleague}
            onChange={setColleague}
            label={form.colleague}
            unassignedLabel={form.noColleague}
          />
          <p className="mt-2 text-[13px] leading-snug text-foreground/60">{form.colleagueHint}</p>
        </Field>

        {error && (
          <p role="alert" className="text-[13.5px] text-danger">
            {copy.errors[error]}
          </p>
        )}
      </div>
    </Modal>
  )
}

/**
 * The one place a temporary password is ever shown.
 *
 * `password` is a prop held by the dialog state that opened this and dropped
 * when it closes. Nothing writes it anywhere: not the store, not storage, not
 * a toast that would outlive the dialog.
 */
function PasswordModal({
  member,
  password,
  copy,
  onClose,
}: {
  member: OrganizationMember
  password: string
  copy: Copy
  onClose: () => void
}) {
  const pw = copy.password
  const [copied, setCopied] = useState(false)

  const copyPassword = () => {
    // Unavailable outside a secure context; the block below is select-all so
    // a triple-click or a long press still gets the whole thing.
    void navigator.clipboard?.writeText(password).then(() => setCopied(true))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={pw.title}
      subtitle={pw.subtitle(member.displayName)}
      width="w-[480px]"
      footer={
        <>
          <span aria-hidden="true" />
          <Button onClick={onClose} className="w-full sm:w-auto">
            {pw.done}
          </Button>
        </>
      }
    >
      <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        <div className="rounded-lg border border-border-subtle bg-background-raised px-3 py-3">
          <p className="label-mono mb-1.5">{copy.form.email}</p>
          <code className="block break-all font-mono text-[14px] text-foreground">{member.email}</code>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-background-raised px-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="label-mono mb-1.5">{pw.label}</p>
            <code className="block select-all break-all font-mono text-[17px] tracking-[0.04em] text-foreground">
              {password}
            </code>
          </div>
          <button
            type="button"
            onClick={copyPassword}
            aria-label={copied ? pw.copied : pw.copy}
            title={copied ? pw.copied : pw.copy}
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-foreground/50 transition-colors hover:bg-surface-raised hover:text-foreground sm:h-9 sm:w-9"
          >
            {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
          </button>
        </div>

        <p className="flex items-start gap-2 text-[13.5px] leading-relaxed text-foreground/60">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <span>{pw.shownOnce}</span>
        </p>
      </div>
    </Modal>
  )
}
