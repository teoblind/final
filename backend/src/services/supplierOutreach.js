/**
 * Supplier Outreach Automation
 *
 * Finds local suppliers (concrete plants, rebar) near project location,
 * drafts quote request emails, tracks responses.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDacpSuppliers, upsertDacpSupplier, updateSupplierQuoteDate } from '../cache/database.js';
import { insertActivity } from '../cache/database.js';

// Google Places API for finding local suppliers
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;

const SUPPLIER_SEARCH_TERMS = {
  concrete_plant: ['ready mix concrete', 'concrete supplier', 'concrete plant', 'ready mixed concrete'],
  rebar: ['rebar supplier', 'reinforcing steel supplier', 'steel fabricator rebar'],
  formwork: ['formwork supplier', 'concrete formwork rental'],
  masonry: ['masonry supplier', 'brick supplier', 'block supplier'],
};

/**
 * Find local suppliers near a project location using Google Places API.
 * Falls back to stored suppliers in DB if API unavailable.
 */
export async function findLocalSuppliers(tenantId, { location, supplierType, radiusMinutes = 15 }) {
  // Convert minutes to approximate miles (assuming ~1 mile/min in metro)
  const radiusMiles = radiusMinutes;
  const radiusMeters = radiusMiles * 1609;

  // First check DB for known suppliers in the area
  const dbSuppliers = getDacpSuppliers(tenantId, supplierType);

  // Try Google Places API if we have a key
  let apiSuppliers = [];
  if (GOOGLE_API_KEY && location) {
    try {
      const coords = await geocodeLocation(location);
      if (coords) {
        apiSuppliers = await searchPlaces(coords, supplierType, radiusMeters);
      }
    } catch (err) {
      console.warn('[SupplierOutreach] Google Places search failed:', err.message);
    }
  }

  // Merge: DB suppliers take priority (have contact info), add new from API
  const known = new Set(dbSuppliers.map(s => s.name.toLowerCase()));
  const newFromApi = apiSuppliers.filter(s => !known.has(s.name.toLowerCase()));

  // Save new suppliers to DB
  for (const s of newFromApi) {
    const id = uuidv4();
    upsertDacpSupplier({
      id,
      tenantId,
      name: s.name,
      supplierType,
      address: s.address,
      city: s.city,
      state: s.state,
      zip: s.zip,
      lat: s.lat,
      lng: s.lng,
      contactPhone: s.phone,
      website: s.website,
      deliveryRadiusMiles: radiusMiles,
      notes: `Found via Google Places search for ${location}`,
      status: 'active',
    });
  }

  return [...dbSuppliers, ...newFromApi.map(s => ({ ...s, id: uuidv4(), source: 'google_places' }))];
}

/**
 * Geocode an address/location string to lat/lng.
 */
async function geocodeLocation(location) {
  if (!GOOGLE_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.results?.[0]?.geometry?.location) {
      const { lat, lng } = data.results[0].geometry.location;
      return { lat, lng };
    }
  } catch (err) {
    console.warn('[SupplierOutreach] Geocode failed:', err.message);
  }
  return null;
}

/**
 * Search Google Places for suppliers near coordinates.
 */
async function searchPlaces(coords, supplierType, radiusMeters) {
  if (!GOOGLE_API_KEY) return [];
  const searchTerms = SUPPLIER_SEARCH_TERMS[supplierType] || [supplierType];
  const results = [];

  for (const term of searchTerms.slice(0, 2)) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${coords.lat},${coords.lng}&radius=${radiusMeters}&keyword=${encodeURIComponent(term)}&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();

      for (const place of (data.results || []).slice(0, 10)) {
        // Avoid duplicates
        if (results.some(r => r.name === place.name)) continue;

        results.push({
          name: place.name,
          address: place.vicinity || place.formatted_address || '',
          city: '', // Would need Places Details API for structured address
          state: '',
          zip: '',
          lat: place.geometry?.location?.lat,
          lng: place.geometry?.location?.lng,
          phone: '', // Needs Details API
          website: '', // Needs Details API
          rating: place.rating,
          placeId: place.place_id,
        });
      }
    } catch (err) {
      console.warn('[SupplierOutreach] Places search failed for term:', term, err.message);
    }
  }

  return results;
}

/**
 * Draft a quote request email to a supplier.
 */
export function draftSupplierQuoteEmail({ supplier, projectName, projectLocation, scope, dueDate, specialNotes }) {
  const isRebar = supplier.supplierType === 'rebar' || supplier.supplier_type === 'rebar';
  const isConcrete = supplier.supplierType === 'concrete_plant' || supplier.supplier_type === 'concrete_plant';

  let subject = `Quote Request: ${projectName}`;
  let body = '';

  if (isConcrete) {
    body = `We are requesting pricing for concrete supply on the following project:

Project: ${projectName}
Location: ${projectLocation}
${dueDate ? `Bid Due Date: ${dueDate}` : ''}

We are looking for pricing on ready-mix concrete delivered to the job site. Key items:

${scope || '- Standard structural concrete (4000 PSI)\n- Pricing per cubic yard delivered\n- Available pump truck pricing if applicable'}

Please provide:
1. Price per cubic yard for each mix design
2. Delivery charges (if any beyond standard radius)
3. Minimum order requirements
4. Current lead time for scheduling
5. Any fuel surcharges

${specialNotes ? `Additional notes: ${specialNotes}\n` : ''}Please respond at your earliest convenience. We are on a tight bid timeline.`;
  } else if (isRebar) {
    body = `We are requesting a lump sum turnkey quote for reinforcing steel on the following project:

Project: ${projectName}
Location: ${projectLocation}
${dueDate ? `Bid Due Date: ${dueDate}` : ''}

We would like a complete turnkey price including:
1. Material (all rebar as required per plans and specifications)
2. Fabrication (cutting, bending, bundling)
3. Shop drawings and detailing
4. Delivery to job site

${scope || 'Plans and specifications are attached. Please take off quantities from the structural drawings.'}

${specialNotes ? `Additional notes: ${specialNotes}\n` : ''}We prefer a lump sum quote over unit pricing. Please advise on your availability and lead time.`;
  } else {
    body = `We are requesting pricing for ${supplier.supplierType || 'materials'} on the following project:

Project: ${projectName}
Location: ${projectLocation}
${dueDate ? `Bid Due Date: ${dueDate}` : ''}

${scope || 'Please see attached plans and specifications for scope details.'}

${specialNotes ? `Additional notes: ${specialNotes}\n` : ''}Please provide pricing and lead time at your earliest convenience.`;
  }

  return {
    to: supplier.contactEmail || supplier.contact_email || '',
    subject,
    body,
    supplierName: supplier.name,
    supplierType: supplier.supplierType || supplier.supplier_type,
  };
}

/**
 * Generate supplier outreach for a bid request.
 * Returns drafted emails ready for approval/sending.
 */
export async function generateSupplierOutreach(tenantId, { projectName, projectLocation, bidRequestId, scope, dueDate, supplierTypes = ['concrete_plant', 'rebar'] }) {
  const drafts = [];

  for (const type of supplierTypes) {
    const suppliers = await findLocalSuppliers(tenantId, {
      location: projectLocation,
      supplierType: type,
      radiusMinutes: type === 'concrete_plant' ? 15 : 60, // Concrete must be local, rebar can be further
    });

    for (const supplier of suppliers) {
      const draft = draftSupplierQuoteEmail({
        supplier,
        projectName,
        projectLocation,
        scope,
        dueDate,
      });

      if (draft.to) {
        drafts.push({
          ...draft,
          supplierId: supplier.id,
          bidRequestId,
        });
      }
    }
  }

  insertActivity({
    tenantId,
    type: 'agent',
    title: `Generated ${drafts.length} supplier quote requests for ${projectName}`,
    subtitle: `${supplierTypes.join(', ')} - ${projectLocation}`,
    detailJson: JSON.stringify({ bidRequestId, supplierTypes, draftCount: drafts.length }),
    sourceType: 'estimate',
    sourceId: bidRequestId,
    agentId: 'estimating',
  });

  return drafts;
}

export default { findLocalSuppliers, draftSupplierQuoteEmail, generateSupplierOutreach };
