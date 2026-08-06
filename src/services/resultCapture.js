import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const resultCaptureVersion = 1;
export const resultFieldStates = new Set(["[redacted]", "[blank]", "[missing]"]);
export const resultFieldSensitivities = ["standard", "personal", "authentication-secret", "financial"];

const excludedControlTypes = new Set(["button", "file", "hidden", "image", "reset", "submit"]);
const supportedControlTypes = new Set([
  "checkbox", "date", "datetime-local", "email", "month", "number", "password",
  "radio", "range", "search", "select", "select-multiple", "tel", "text",
  "textarea", "time", "url", "week"
]);
const maxManifestFields = 240;
const maxFieldIdLength = 96;
const maxFieldLabelLength = 160;
const maxFieldValueLength = 16 * 1024;
const sensitivitySet = new Set(resultFieldSensitivities);

function captureSecret() {
  return process.env.RESULT_CAPTURE_SECRET
    || process.env.JWT_SECRET
    || "deuce-pages-result-capture-secret";
}

function compactText(value = "", limit = maxFieldLabelLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function decodeHtmlText(value = "") {
  return compactText(String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">"));
}

function slug(value = "", fallback = "field") {
  const clean = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 44);
  return clean || fallback;
}

function digest(value = "", length = 12) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function parseAttributes(source = "") {
  const attributes = {};
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = expression.exec(String(source || "")))) {
    const name = String(match[1] || "").toLowerCase();
    if (!name) continue;
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function stripCaptureAttribute(source, name) {
  const pattern = new RegExp(`\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, "gi");
  return String(source || "").replace(pattern, "");
}

function normalizedControlType(tag, attributes = {}) {
  if (tag === "select") return Object.hasOwn(attributes, "multiple") ? "select-multiple" : "select";
  if (tag === "textarea") return "textarea";
  const requested = String(attributes.type || "text").toLowerCase().trim();
  if (excludedControlTypes.has(requested)) return "";
  return supportedControlTypes.has(requested) ? requested : "text";
}

function labelMapForHtml(html = "") {
  const labels = new Map();
  const expression = /<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi;
  let match;
  while ((match = expression.exec(String(html || "")))) {
    const attributes = parseAttributes(match[1]);
    const target = compactText(attributes.for || "", 120);
    const text = decodeHtmlText(match[2]);
    if (target && text && !labels.has(target)) labels.set(target, text);
  }
  return labels;
}

function fieldLabel(tag, attributes, labels, index) {
  const linked = attributes.id ? labels.get(String(attributes.id)) : "";
  return compactText(
    attributes["aria-label"]
      || linked
      || attributes.placeholder
      || attributes.name
      || attributes.id
      || `${tag === "select" ? "Select" : tag === "textarea" ? "Text area" : "Field"} ${index + 1}`
  );
}

function formScopesForHtml(html = "", screenFile = "") {
  const scopes = [];
  const ids = new Map();
  const expression = /<form\b([^>]*)>/gi;
  let match;
  let index = 0;
  while ((match = expression.exec(String(html || "")))) {
    const attributes = parseAttributes(match[1]);
    const key = attributes.id || attributes.name || `form_${index + 1}`;
    const id = `frm_${slug(key, "form")}_${digest(`${screenFile}:${key}:${index}`)}`;
    const scope = { id, sourceId: compactText(attributes.id || "", 120), index };
    scopes.push(scope);
    if (scope.sourceId) ids.set(scope.sourceId, scope.id);
    index += 1;
  }
  return { scopes, ids };
}

function canonicalManifest(manifest = {}) {
  return {
    version: resultCaptureVersion,
    screenFile: compactText(manifest.screenFile || "", 240),
    revision: compactText(manifest.revision || "", 96),
    fields: (Array.isArray(manifest.fields) ? manifest.fields : []).slice(0, maxManifestFields).map((field) => ({
      id: compactText(field.id || "", maxFieldIdLength),
      label: compactText(field.label || "Field"),
      type: normalizedSubmittedType(field.type),
      scopeId: compactText(field.scopeId || "page", 96),
      required: Boolean(field.required)
    }))
  };
}

function manifestRevision(screenFile, fields) {
  return `sha256:${createHash("sha256").update(JSON.stringify({ screenFile, fields })).digest("hex")}`;
}

function inferredSensitivity(field = {}) {
  const text = `${field.label || ""} ${field.id || ""} ${field.type || ""}`.toLowerCase();
  if (/password|passcode|otp|one.?time|verification|2fa|mfa|pin|security.?answer|secret|credential/.test(text)) return "authentication-secret";
  if (/card|credit|debit|cvv|cvc|routing|bank|account|expiry|iban|swift/.test(text)) return "financial";
  if (/name|email|phone|address|birth|dob|ssn|social|country|city|postal|zip/.test(text)) return "personal";
  return "standard";
}

function persistentFieldRevision(screenId, fields) {
  const canonical = fields.map((field) => ({
    id: field.id,
    label: field.label,
    sourceLabel: field.sourceLabel,
    type: field.type,
    sourceType: field.sourceType,
    scopeId: field.scopeId,
    required: field.required,
    sourceRequired: field.sourceRequired,
    enabled: field.enabled,
    sensitivity: field.sensitivity,
    policy: field.policy
  }));
  return `sha256:${createHash("sha256").update(JSON.stringify({ screenId, fields: canonical })).digest("hex")}`;
}

export function instrumentResultFields(html = "", { screenFile = "", screenKey = screenFile } = {}) {
  const source = String(html || "");
  const labels = labelMapForHtml(source);
  const identityKey = "field-manifest-v1";
  const { scopes, ids: formIds } = formScopesForHtml(source, identityKey);
  const fields = [];
  const fieldByGroup = new Map();
  const occurrences = new Map();
  let formIndex = 0;
  let currentScopeId = "page";
  let controlIndex = 0;

  const instrumentedHtml = source.replace(/<form\b([^>]*)>|<\/form\s*>|<(input|select|textarea)\b([^>]*)>/gi, (match, formAttributes, controlTag, controlAttributes) => {
    if (/^<\/form/i.test(match)) {
      currentScopeId = "page";
      return match;
    }

    if (/^<form/i.test(match)) {
      const scope = scopes[formIndex++] || { id: `frm_form_${digest(`${identityKey}:${formIndex}`)}` };
      currentScopeId = scope.id;
      let cleanAttributes = stripCaptureAttribute(formAttributes || "", "data-deuce-form-id");
      return `<form${cleanAttributes} data-deuce-form-id="${scope.id}">`;
    }

    const tag = String(controlTag || "").toLowerCase();
    const attributes = parseAttributes(controlAttributes || "");
    const type = normalizedControlType(tag, attributes);
    if (!type || fields.length >= maxManifestFields) return match;

    const scopeId = attributes.form && formIds.get(attributes.form)
      ? formIds.get(attributes.form)
      : currentScopeId;
    const label = fieldLabel(tag, attributes, labels, controlIndex);
    const identity = attributes.name || attributes.id || attributes["aria-label"] || attributes.placeholder || label;
    const groupable = (type === "checkbox" || type === "radio") && Boolean(attributes.name);
    const groupKey = `${scopeId}:${type}:${String(identity).toLowerCase()}`;
    const occurrenceKey = `${scopeId}:${type}:${String(identity).toLowerCase()}`;
    const occurrence = occurrences.get(occurrenceKey) || 0;
    const fieldId = groupable && fieldByGroup.has(groupKey)
      ? fieldByGroup.get(groupKey).id
      : `fld_${slug(identity)}_${digest(`${identityKey}:${scopeId}:${type}:${identity}:${groupable ? "group" : occurrence}`)}`;

    if (!groupable || !fieldByGroup.has(groupKey)) {
      const field = {
        id: fieldId.slice(0, maxFieldIdLength),
        label,
        type,
        scopeId,
        required: Object.hasOwn(attributes, "required")
      };
      fields.push(field);
      if (groupable) fieldByGroup.set(groupKey, field);
      occurrences.set(occurrenceKey, occurrence + 1);
    } else if (Object.hasOwn(attributes, "required")) {
      fieldByGroup.get(groupKey).required = true;
    }

    controlIndex += 1;
    const selfClosing = /\/\s*$/.test(controlAttributes || "");
    let cleanAttributes = String(controlAttributes || "").replace(/\/\s*$/, "");
    cleanAttributes = stripCaptureAttribute(cleanAttributes, "data-deuce-field-id");
    cleanAttributes = stripCaptureAttribute(cleanAttributes, "data-deuce-field-type");
    return `<${tag}${cleanAttributes} data-deuce-field-id="${fieldId}" data-deuce-field-type="${type}"${selfClosing ? " /" : ""}>`;
  });

  const cleanScreenFile = compactText(screenFile, 240);
  const manifest = canonicalManifest({
    screenFile: cleanScreenFile,
    fields,
    revision: manifestRevision(cleanScreenFile, fields)
  });
  return { html: instrumentedHtml, manifest };
}

export function normalizePersistentFieldManifest(fieldManifest = {}, { screenId = "" } = {}) {
  const seen = new Set();
  const warnings = [];
  const fields = (Array.isArray(fieldManifest?.fields) ? fieldManifest.fields : [])
    .slice(0, maxManifestFields)
    .map((field, index) => {
      const id = compactText(field?.id || `field_${index + 1}`, maxFieldIdLength);
      if (!id || seen.has(id)) {
        if (id) warnings.push(`Duplicate field id: ${id}`);
        return null;
      }
      seen.add(id);
      const label = compactText(field?.label || id.replace(/[_-]+/g, " ")) || `Field ${index + 1}`;
      const sensitivity = sensitivitySet.has(String(field?.sensitivity || "").toLowerCase())
        ? String(field.sensitivity).toLowerCase()
        : inferredSensitivity({ ...field, id, label });
      const type = normalizedSubmittedType(field?.type);
      const sourceType = normalizedSubmittedType(field?.sourceType || type);
      const required = Boolean(field?.required);
      const sourceRequired = field?.sourceRequired === undefined ? required : Boolean(field.sourceRequired);
      return {
        id,
        label,
        sourceLabel: compactText(field?.sourceLabel || label) || label,
        type,
        sourceType,
        scopeId: compactText(field?.scopeId || "page", 96) || "page",
        required,
        sourceRequired,
        enabled: field?.enabled !== false,
        sensitivity,
        policy: "redact",
        needsReview: Boolean(field?.needsReview)
      };
    })
    .filter(Boolean);
  const duplicateLabels = new Map();
  for (const field of fields) {
    const key = field.label.toLowerCase();
    duplicateLabels.set(key, (duplicateLabels.get(key) || 0) + 1);
  }
  for (const [label, count] of duplicateLabels) {
    if (count > 1) warnings.push(`Duplicate field label: ${label}`);
  }
  for (const warning of Array.isArray(fieldManifest?.warnings) ? fieldManifest.warnings : []) {
    const clean = compactText(warning, 200);
    if (clean) warnings.push(clean);
  }
  const cleanScreenId = compactText(screenId || fieldManifest?.screenId || "screen", 96);
  return {
    version: resultCaptureVersion,
    screenId: cleanScreenId,
    revision: persistentFieldRevision(cleanScreenId, fields),
    fields,
    warnings: [...new Set(warnings)].slice(0, 40),
    needsReview: Boolean(fieldManifest?.needsReview || fields.some((field) => field.needsReview))
  };
}

export function createPersistentFieldManifest(html = "", { screenFile = "", screenId = "" } = {}) {
  const source = String(html || "");
  const detected = instrumentResultFields(source, { screenFile, screenKey: screenId || screenFile }).manifest;
  const warnings = [];
  const customControls = (source.match(/\bcontenteditable\b|role\s*=\s*["'](?:combobox|textbox|listbox)["']/gi) || []).length;
  if (customControls) warnings.push(`${customControls} custom control${customControls === 1 ? " requires" : "s require"} manual review`);
  let genericLabels = 0;
  const fields = detected.fields.map((field, index) => {
    const genericLabel = /^(?:field|select|text area)\s+\d+$/i.test(field.label);
    if (genericLabel) {
      genericLabels += 1;
      warnings.push(`Field ${index + 1} has no descriptive label, name, id, or placeholder`);
    }
    return {
      ...field,
      enabled: true,
      sensitivity: inferredSensitivity(field),
      policy: "redact",
      needsReview: genericLabel
    };
  });
  const labelCounts = new Map();
  for (const field of fields) labelCounts.set(field.label.toLowerCase(), (labelCounts.get(field.label.toLowerCase()) || 0) + 1);
  const duplicateLabels = [...labelCounts.values()].some((count) => count > 1);
  return normalizePersistentFieldManifest({
    fields,
    warnings,
    needsReview: Boolean(customControls || genericLabels || duplicateLabels)
  }, { screenId });
}

export function reconcilePersistentFieldManifest(previous = {}, next = {}, { screenId = "" } = {}) {
  const current = normalizePersistentFieldManifest(previous, { screenId });
  const detected = normalizePersistentFieldManifest(next, { screenId });
  const currentById = new Map(current.fields.map((field) => [field.id, field]));
  const detectedById = new Map(detected.fields.map((field) => [field.id, field]));
  const added = [];
  const removed = [];
  const changed = [];
  const fields = detected.fields.map((field) => {
    const existing = currentById.get(field.id);
    if (!existing) {
      added.push({ id: field.id, label: field.label, type: field.type });
      return { ...field, needsReview: true };
    }
    const sourceLabelChanged = existing.sourceLabel !== field.sourceLabel;
    const sourceTypeChanged = existing.sourceType !== field.sourceType;
    const sourceRequiredChanged = existing.sourceRequired !== field.sourceRequired;
    if (sourceTypeChanged || existing.scopeId !== field.scopeId || sourceRequiredChanged || sourceLabelChanged) {
      changed.push({
        id: field.id,
        label: existing.label,
        fromLabel: existing.sourceLabel,
        toLabel: field.sourceLabel,
        fromType: existing.sourceType,
        toType: field.sourceType
      });
    }
    return {
      ...field,
      label: existing.label === existing.sourceLabel ? field.label : existing.label,
      sourceLabel: field.sourceLabel,
      type: existing.type === existing.sourceType ? field.type : existing.type,
      sourceType: field.sourceType,
      required: existing.required === existing.sourceRequired ? field.required : existing.required,
      sourceRequired: field.sourceRequired,
      enabled: existing.enabled,
      sensitivity: existing.sensitivity,
      policy: "redact",
      needsReview: Boolean(existing.needsReview || sourceTypeChanged || existing.scopeId !== field.scopeId || sourceRequiredChanged || sourceLabelChanged)
    };
  });
  for (const field of current.fields) {
    if (!detectedById.has(field.id)) removed.push({ id: field.id, label: field.label, type: field.type });
  }
  const hasChanges = Boolean(added.length || removed.length || changed.length);
  const manifest = normalizePersistentFieldManifest({
    fields,
    warnings: detected.warnings,
    needsReview: hasChanges || detected.needsReview
  }, { screenId });
  return { manifest, diff: { added, removed, changed, hasChanges } };
}

export function trustedResultManifestFromPersistent(fieldManifest = {}, { screenFile = "", screenId = "" } = {}) {
  const persistent = normalizePersistentFieldManifest(fieldManifest, { screenId });
  const fields = persistent.fields
    .filter((field) => field.enabled)
    .map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      scopeId: field.scopeId,
      required: field.required
    }));
  const cleanScreenFile = compactText(screenFile, 240);
  return canonicalManifest({
    screenFile: cleanScreenFile,
    fields,
    revision: manifestRevision(cleanScreenFile, fields)
  });
}

export function signResultFieldManifest(manifest, { userPageId = "", expiresInSeconds = 6 * 60 * 60 } = {}) {
  const safeManifest = canonicalManifest(manifest);
  const payload = {
    version: resultCaptureVersion,
    userPageId: compactText(userPageId, 120),
    expiresAt: Date.now() + Math.max(Number(expiresInSeconds) || 0, 60) * 1000,
    manifest: safeManifest
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", captureSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyResultFieldManifest(token, { userPageId = "", screenFile = "" } = {}) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) throw new Error("Result field manifest is required");
  const expected = createHmac("sha256", captureSecret()).update(encoded).digest("base64url");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    throw new Error("Result field manifest is invalid");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Result field manifest is invalid");
  }
  if (payload.version !== resultCaptureVersion || Number(payload.expiresAt) < Date.now()) {
    throw new Error("Result field manifest has expired");
  }
  if (compactText(payload.userPageId, 120) !== compactText(userPageId, 120)) {
    throw new Error("Result field manifest does not match this page");
  }
  const manifest = canonicalManifest(payload.manifest);
  if (screenFile && manifest.screenFile.toLowerCase() !== compactText(screenFile, 240).toLowerCase()) {
    throw new Error("Result field manifest does not match this screen");
  }
  return manifest;
}

export function normalizedSubmittedType(value = "") {
  const type = String(value || "text").toLowerCase().trim();
  return supportedControlTypes.has(type) ? type : "text";
}

function blankSubmittedValue(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return !value.some((item) => !blankSubmittedValue(item));
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function uniqueLabel(label, usedLabels) {
  const base = compactText(label || "Field") || "Field";
  const key = base.toLowerCase();
  const count = usedLabels.get(key) || 0;
  usedLabels.set(key, count + 1);
  return count ? `${base} (${count + 1})` : base;
}

function safeIncomingFields(capture = {}) {
  if (!Array.isArray(capture.fields)) return [];
  return capture.fields.slice(0, maxManifestFields * 2).map((field) => ({
    id: compactText(field?.id || "", maxFieldIdLength),
    type: normalizedSubmittedType(field?.type),
    value: Array.isArray(field?.value)
      ? field.value.slice(0, 100).map((value) => String(value ?? "").slice(0, maxFieldValueLength))
      : String(field?.value ?? "").slice(0, maxFieldValueLength)
  })).filter((field) => field.id);
}

export function redactStructuredResultCapture(capture = {}, manifest = {}) {
  const trustedManifest = canonicalManifest(manifest);
  const requestedScope = compactText(capture.scopeId || "page", 96) || "page";
  const expectedFields = trustedManifest.fields.filter((field) => field.scopeId === requestedScope);
  const incoming = safeIncomingFields(capture);
  const submittedById = new Map();
  for (const field of incoming) {
    if (!submittedById.has(field.id)) submittedById.set(field.id, field);
  }

  const payload = {};
  const usedLabels = new Map();
  for (const field of expectedFields) {
    const submitted = submittedById.get(field.id);
    const label = uniqueLabel(field.label, usedLabels);
    if (!submitted) {
      payload[label] = "[missing]";
      continue;
    }
    payload[label] = blankSubmittedValue(submitted.value) ? "[blank]" : "[redacted]";
  }
  return payload;
}

export function serverNormalizedFieldManifest(capture = {}, { screenFile = "" } = {}) {
  const scopeId = compactText(capture.scopeId || "page", 96) || "page";
  const seen = new Set();
  const fields = (Array.isArray(capture.fields) ? capture.fields : [])
    .slice(0, maxManifestFields)
    .map((field, index) => {
      const id = compactText(field?.id || `field_${index + 1}`, maxFieldIdLength);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label: compactText(field?.label || id.replace(/[_-]+/g, " ")) || `Field ${index + 1}`,
        type: normalizedSubmittedType(field?.type),
        scopeId,
        required: false
      };
    })
    .filter(Boolean);
  const cleanScreenFile = compactText(screenFile, 240);
  return canonicalManifest({
    screenFile: cleanScreenFile,
    fields,
    revision: manifestRevision(cleanScreenFile, fields)
  });
}

function redactLegacyValue(value, preserveStates = false) {
  if (value === null || value === undefined || value === "") return "[blank]";
  if (preserveStates && resultFieldStates.has(value)) return value;
  if (Array.isArray(value)) return blankSubmittedValue(value) ? "[blank]" : "[redacted]";
  if (typeof value === "object") return normalizeLegacyResultPayload(value, preserveStates);
  return blankSubmittedValue(value) ? "[blank]" : "[redacted]";
}

function normalizeLegacyResultPayload(payload = {}, preserveStates = false) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const safe = {};
  for (const [key, value] of Object.entries(payload)) {
    const label = compactText(key);
    if (!label || label.startsWith("_")) continue;
    safe[label] = redactLegacyValue(value, preserveStates);
  }
  return safe;
}

export function redactLegacyResultPayload(payload = {}) {
  return normalizeLegacyResultPayload(payload, false);
}

export function sanitizeStoredResultPayload(payload = {}) {
  return normalizeLegacyResultPayload(payload, true);
}
