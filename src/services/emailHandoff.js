const allowedFieldTypes = new Set(["email", "text", "tel", "textarea"]);

function cleanFieldId(value = "") {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : "";
}

export function normalizeEmailHandoff(value = {}, screens = [], issues = []) {
  const enabled = Boolean(value?.enabled);
  const sourceFieldId = cleanFieldId(value?.sourceFieldId);
  const destinationFieldId = cleanFieldId(value?.destinationFieldId);
  const clearOnFinalScreen = value?.clearOnFinalScreen !== false;
  const fields = new Map();
  for (const screen of Array.isArray(screens) ? screens : []) {
    for (const field of screen?.fieldManifest?.fields || []) {
      if (field?.id) fields.set(String(field.id), field);
    }
  }
  if (enabled) {
    const source = fields.get(sourceFieldId);
    const destination = fields.get(destinationFieldId);
    if (!source) issues.push("Select a valid source email field for session handoff");
    if (!destination) issues.push("Select a valid destination email field for session handoff");
    if (source && !allowedFieldTypes.has(String(source.type || "text").toLowerCase())) issues.push("The email handoff source must be an email, text, telephone, or textarea field");
    if (destination && !allowedFieldTypes.has(String(destination.type || "text").toLowerCase())) issues.push("The email handoff destination must be an email, text, telephone, or textarea field");
    if (sourceFieldId && sourceFieldId === destinationFieldId) issues.push("Source and destination email fields must be different");
  }
  return { enabled, sourceFieldId, destinationFieldId, clearOnFinalScreen };
}

export function emailHandoffForPackage(pagePackage = {}) {
  const manifest = pagePackage.packageManifest || {};
  return normalizeEmailHandoff(manifest.emailHandoff, manifest.screens || [], []);
}
