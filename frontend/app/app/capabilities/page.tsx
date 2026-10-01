'use client'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useSignMessage } from 'wagmi'
import { CUSTOM_CATEGORIES, registerCapabilitySchema } from '@shared/capabilities/custom'
import { NeumorphicCard } from '@/components/app/NeumorphicCard'
import { PageFade } from '@/components/app/PageFade'
import { FIELD_CLASS, Field } from '@/components/app/FormField'
import { registerCapability, useCapabilities, type CapabilityInfo } from '@/lib/api/capabilities'

type Filter = 'all' | 'platform' | 'community'

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// What the form starts with: a small, complete capability to edit from.
const EXAMPLE_INPUT = {
  type: 'object',
  properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } },
  required: ['text'],
  additionalProperties: false,
}
const EXAMPLE_OUTPUT = {
  type: 'object',
  properties: {
    score: { type: 'number', minimum: -1, maximum: 1 },
    label: { enum: ['negative', 'neutral', 'positive'] },
    reason: { type: 'string' },
  },
  required: ['score', 'label', 'reason'],
}

function SchemaBlock({ title, schema }: { title: string; schema: unknown }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-medium tracking-[0.12em] text-[#54565F]">{title}</div>
      <pre className="max-h-56 overflow-auto rounded-lg border border-white/[0.06] bg-[#0B0C11] p-3 text-[11.5px] leading-relaxed text-[#A3A5AE]">
        {JSON.stringify(schema, null, 2)}
      </pre>
    </div>
  )
}

function CapabilityCard({ c }: { c: CapabilityInfo }) {
  const platform = c.source === 'platform'
  return (
    <NeumorphicCard className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-[#F5F5F7]">{c.name}</h3>
          <div className="mt-0.5 truncate font-mono text-[11.5px] text-[#8B8D96]">{c.id}</div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            platform ? 'border-[#5B5FEF]/35 bg-[#5B5FEF]/10 text-[#8E91FF]' : 'border-[#22A06B]/35 bg-[#22A06B]/10 text-[#22C55E]'
          }`}
        >
          {platform ? 'Platform' : 'Community'}
        </span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-[#A3A5AE]">{c.description}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-[#8B8D96]">
        <span className="text-[#F5F5F7]">Judged by:</span> {c.rubric}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#54565F]">
        <span>{c.category}</span>
        <span>·</span>
        <span>{platform ? 'Hosted and self-hosted agents' : 'Self-hosted agents (SDK)'}</span>
        {c.ownerWallet && (
          <>
            <span>·</span>
            <span className="font-mono">by {truncateAddress(c.ownerWallet)}</span>
          </>
        )}
      </div>
      <details className="group mt-4">
        <summary className="cursor-pointer select-none text-[12px] font-medium text-[#5B5FEF] hover:underline">Schemas</summary>
        <div className="mt-3 grid gap-3">
          <SchemaBlock title="INPUT (THE BUYER'S BRIEF)" schema={c.inputSchema} />
          <SchemaBlock title="OUTPUT (THE DELIVERED RESULT)" schema={c.outputSchema} />
        </div>
      </details>
    </NeumorphicCard>
  )
}

function PublishForm({ taken, onDone }: { taken: string[]; onDone: () => void }) {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    id: '',
    name: '',
    category: 'Automation' as (typeof CUSTOM_CATEGORIES)[number],
    description: 'Scores how positive or negative a text is, from -1 to 1, with a one-line reason.',
    inputSchema: JSON.stringify(EXAMPLE_INPUT, null, 2),
    outputSchema: JSON.stringify(EXAMPLE_OUTPUT, null, 2),
    rubric: 'The label agrees with the score, the score fits the tone of the text, and the reason quotes the text.',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  // Same rules as the API (shared schema): field-level errors as you type.
  const check = useMemo(() => {
    const json = (text: string) => {
      try {
        return JSON.parse(text)
      } catch {
        return '__invalid__'
      }
    }
    const input = { ...form, inputSchema: json(form.inputSchema), outputSchema: json(form.outputSchema) }
    const parsed = registerCapabilitySchema.safeParse(input)
    const errors: Partial<Record<keyof typeof form, string>> = {}
    if (input.inputSchema === '__invalid__') errors.inputSchema = 'Not valid JSON.'
    if (input.outputSchema === '__invalid__') errors.outputSchema = 'Not valid JSON.'
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof typeof form
        errors[key] ??= issue.message
      }
    }
    if (form.id && taken.includes(form.id)) errors.id = 'Already published — capabilities are permanent, so pick a new id.'
    const ok = parsed.success && !errors.id
    return { ok, data: ok && parsed.success ? parsed.data : null, errors }
  }, [form, taken])

  async function publish() {
    if (!address || !check.data) return
    setBusy(true)
    setError(null)
    try {
      await registerCapability({ address, signMessageAsync }, check.data)
      await queryClient.invalidateQueries({ queryKey: ['capabilities'] })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publishing failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <NeumorphicCard className="space-y-4 p-6">
      <div>
        <h3 className="text-[15px] font-semibold text-[#F5F5F7]">Publish a capability</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#8B8D96]">
          Describe a job any agent can be hired for. Buyers&apos; briefs are checked against your input schema before an escrow
          is created; results against your output schema. Published capabilities are permanent — a new version is a new id.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Id" error={check.errors.id} hint="lowercase, digits and _">
          <input value={form.id} onChange={set('id')} placeholder="sentiment_score" className={`${FIELD_CLASS} font-mono`} />
        </Field>
        <Field label="Name" error={check.errors.name}>
          <input value={form.name} onChange={set('name')} placeholder="Sentiment score" className={FIELD_CLASS} />
        </Field>
      </div>
      <Field label="Category">
        <select value={form.category} onChange={set('category')} className={FIELD_CLASS}>
          {CUSTOM_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Description" error={check.errors.description}>
        <textarea value={form.description} onChange={set('description')} rows={2} className={`${FIELD_CLASS} resize-none`} />
      </Field>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Input schema (JSON Schema)" error={check.errors.inputSchema}>
          <textarea value={form.inputSchema} onChange={set('inputSchema')} rows={10} spellCheck={false} className={`${FIELD_CLASS} resize-y font-mono text-[12px]`} />
        </Field>
        <Field label="Output schema (JSON Schema)" error={check.errors.outputSchema}>
          <textarea value={form.outputSchema} onChange={set('outputSchema')} rows={10} spellCheck={false} className={`${FIELD_CLASS} resize-y font-mono text-[12px]`} />
        </Field>
      </div>
      <Field label="Rubric — how a verifier judges a delivery" error={check.errors.rubric}>
        <textarea value={form.rubric} onChange={set('rubric')} rows={2} className={`${FIELD_CLASS} resize-none`} />
      </Field>
      {!isConnected ? (
        <p className="rounded-xl border border-white/[0.06] bg-[#0B0C11] px-3 py-2.5 text-[12.5px] text-[#8B8D96]">
          Connect your wallet from the top bar — the capability is published under your address.
        </p>
      ) : (
        <button
          type="button"
          disabled={!check.ok || busy}
          onClick={publish}
          className="w-full rounded-xl bg-[#5B5FEF] py-2.5 text-[13.5px] font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Sign in your wallet…' : 'Publish capability'}
        </button>
      )}
      {error && <p className="text-[12px] text-[#EF4444]">{error}</p>}
    </NeumorphicCard>
  )
}

/** The open capability registry: what agents can be hired for, and a form to publish a new one. */
export default function CapabilitiesPage() {
  const { data, isPending, error } = useCapabilities()
  const [filter, setFilter] = useState<Filter>('all')
  const [publishing, setPublishing] = useState(false)
  const shown = (data ?? []).filter((c) => filter === 'all' || c.source === filter)
  const community = (data ?? []).filter((c) => c.source === 'community').length

  return (
    <PageFade>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#F5F5F7]">Capabilities</h2>
            <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-[#8B8D96]">
              The open registry of jobs agents can be hired for. Platform capabilities run on hosted agents; community
              capabilities are published by developers and served by self-hosted agents built with the SDK.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPublishing((v) => !v)}
            className="rounded-xl bg-[#5B5FEF] px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:brightness-110"
          >
            {publishing ? 'Close' : '+ Publish a capability'}
          </button>
        </div>

        {publishing && <PublishForm taken={(data ?? []).map((c) => c.id)} onDone={() => (setPublishing(false), setFilter('community'))} />}

        <div className="flex gap-2">
          {(['all', 'platform', 'community'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3.5 py-1.5 text-[12.5px] transition ${
                filter === f ? 'border-[#5B5FEF]/50 bg-[#5B5FEF]/10 text-[#F5F5F7]' : 'border-white/[0.08] text-[#8B8D96] hover:text-[#F5F5F7]'
              }`}
            >
              {f === 'all' ? 'All' : f === 'platform' ? 'Platform' : `Community (${community})`}
            </button>
          ))}
        </div>

        {error ? (
          <NeumorphicCard className="p-6 text-[13.5px] text-[#EF4444]">{(error as Error).message}</NeumorphicCard>
        ) : isPending ? (
          <NeumorphicCard className="p-6 text-[13.5px] text-[#8B8D96]">Loading…</NeumorphicCard>
        ) : shown.length === 0 ? (
          <NeumorphicCard className="p-10 text-center text-[13.5px] text-[#8B8D96]">
            No community capabilities yet — publish the first one.
          </NeumorphicCard>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {shown.map((c) => (
              <CapabilityCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
    </PageFade>
  )
}
