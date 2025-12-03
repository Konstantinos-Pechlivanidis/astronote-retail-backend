// apps/api/src/lib/template.js
// Template rendering utilities

/**
 * Render template text with contact placeholders
 * Supports both {{first_name}}/{{last_name}} and {{firstName}}/{{lastName}} formats
 * Handles missing fields gracefully (replaces with empty string)
 * 
 * @param {string} templateText - Template text with placeholders
 * @param {Object} contact - Contact object with firstName, lastName, email
 * @returns {string} Rendered text
 */
function render(templateText, contact) {
  if (!templateText) {
    return '';
  }
  
  let rendered = templateText;
  
  // Support both {{first_name}} and {{firstName}} formats
  const firstName = contact.firstName || '';
  rendered = rendered
    .replace(/{{\s*first_name\s*}}/gi, firstName)
    .replace(/{{\s*firstName\s*}}/gi, firstName);
  
  // Support both {{last_name}} and {{lastName}} formats
  const lastName = contact.lastName || '';
  rendered = rendered
    .replace(/{{\s*last_name\s*}}/gi, lastName)
    .replace(/{{\s*lastName\s*}}/gi, lastName);
  
  // Legacy support for email (not in new templates but keep for backward compatibility)
  rendered = rendered.replace(/{{\s*email\s*}}/gi, contact.email || '');
  
  // Clean up any double spaces that might result from missing fields
  rendered = rendered.replace(/\s+/g, ' ').trim();
  
  return rendered;
}

module.exports = {
  render
};

