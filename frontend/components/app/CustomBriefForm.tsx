'use client'
import { validateWithSchema, type CapabilityInfo } from '@shared/capabilities/custom'
import { LIMITS } from '@shared/capabilities/definitions'
import { CharCount, FIELD_CLASS, Field } from './FormField'

/**
 * The brief for a community capability (open registry): JSON, checked live
 * against the capability's published input schema — the same check the API
 * and the seller run before any money moves.
 */
export function CustomBriefForm({
  capability,
  json,
  onJsonChange,
  criteria,
  onCriteriaChange,
  showErrors,
}: {
  capability: CapabilityInfo
  json: string
  onJsonChange: (v: string) => void
  criteria: string
  onCriteriaChange: (v: string) => void
  showErrors: boolean
}) {
  const check = parseCustomBrief(capability, json)
  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-[#8B8D96]">
        <span className="text-[#F5F5F7]">{capability.name}</span> is a community capability. Write the brief as JSON
        that matches its input schema.
      </p>
      <Field label="Brief (JSON)" error={showErrors && !check.ok ? check.error : undefined} hint={check.ok ? '✓ matches the input schema' : undefined}>
        <textarea
          value={json}
          onChange={(e) => onJsonChange(e.target.value)}
          rows={7}
          spellCheck={false}
          className={`${FIELD_CLASS} resize-y font-mono text-[12.5px]`}
        />
      </Field>
      <Field label="Acceptance criteria (optional)" hint={<CharCount value={criteria} max={LIMITS.textChars} />}>
        <textarea
          value={criteria}
          onChange={(e) => onCriteriaChange(e.target.value)}
          rows={2}
          maxLength={LIMITS.textChars}
          placeholder="What a good result must satisfy — the verifier and the arbiter read this."
          className={`${FIELD_CLASS} resize-none`}
        />
      </Field>
    </div>
  )
}

/** The brief as an object, if it is valid JSON that the capability's input schema accepts. */
export function parseCustomBrief(capability: CapabilityInfo, json: string): { ok: true; brief: unknown } | { ok: false; error: string } {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return { ok: false, error: 'Not valid JSON yet.' }
  }
  const checked = validateWithSchema(capability.inputSchema, value)
  return checked.ok ? { ok: true, brief: checked.data } : { ok: false, error: checked.error }
}
