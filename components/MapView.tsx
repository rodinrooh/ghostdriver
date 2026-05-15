'use client'

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
)

interface Incident {
  id: number
  report_id: string
  company: string
  city: string
  state: string
  date: string
  time: string
  crash_with: string
  injury: string
  narrative: string
  lat: number
  lng: number
}

const COMPANIES = ['All', 'Waymo', 'Zoox', 'Motional', 'Avride', 'Aurora', 'WeRide']

const COMPANY_COLORS: Record<string, string> = {
  Waymo: '#00C2FF',
  Zoox: '#FF6B35',
  Motional: '#A855F7',
  Avride: '#22C55E',
  Aurora: '#F59E0B',
  WeRide: '#EC4899',
}

// Normalize "Waymo LLC" → "Waymo", "Zoox, Inc." → "Zoox", etc.
function normalizeCompany(company: string): string {
  if (!company) return ''
  const lower = company.toLowerCase()
  if (lower.includes('waymo')) return 'Waymo'
  if (lower.includes('zoox')) return 'Zoox'
  if (lower.includes('motional')) return 'Motional'
  if (lower.includes('avride')) return 'Avride'
  if (lower.includes('aurora')) return 'Aurora'
  if (lower.includes('weride')) return 'WeRide'
  return company
}

// NHTSA severity values:
//   "Fatality"
//   "Moderate W/ Hospitalization" / "Moderate W/O Hospitalization"
//   "Minor W/ Hospitalization" / "Minor W/O Hospitalization"
//   "Property Damage. No Injured Reported"
//   "No Injured Reported"
//   "Unknown"
function getDotColor(injury: string): [string, string] {
  if (!injury) return ['#6B7280', 'Unknown']
  const lower = injury.toLowerCase()
  if (lower.includes('fatal')) return ['#7F1D1D', 'Fatality']
  if (
    lower.includes('minor') ||
    lower.includes('moderate') ||
    lower.includes('serious') ||
    (lower.includes('hospitalization') && !lower.includes('no injured'))
  ) return ['#EF4444', 'Injury reported']
  if (lower.includes('property') || lower.includes('no injured') || lower.includes('no injury')) {
    return ['#EAB308', 'Property damage only']
  }
  if (lower.includes('unknown')) return ['#6B7280', 'Unknown']
  return ['#6B7280', 'Unknown']
}

// Parse NHTSA "MON-YYYY" format → "April 2026"
const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
}
function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const m = dateStr.match(/^([A-Z]{3})-(\d{4})$/)
  if (m) {
    const month = MONTH_MAP[m[1]]
    if (month !== undefined) {
      return new Date(parseInt(m[2]), month, 1)
        .toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    }
  }
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch { return dateStr }
}

async function fetchAllIncidents(): Promise<Incident[]> {
  const PAGE = 1000
  let all: Incident[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .order('date', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selected, setSelected] = useState<Incident | null>(null)
  const [activeFilter, setActiveFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [mapReady, setMapReady] = useState(false)

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

  useEffect(() => {
    fetchAllIncidents().then(data => {
      setIncidents(data)
      setLoading(false)
    })
  }, [])

  const filteredIncidents = activeFilter === 'All'
    ? incidents
    : incidents.filter(i => normalizeCompany(i.company) === activeFilter)

  // Init map
  useEffect(() => {
    if (!mapContainer.current || map.current || !token) return
    mapboxgl.accessToken = token
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98, 38],
      zoom: 4,
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right')
    map.current.on('load', () => setMapReady(true))
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [token])

  // Sync markers whenever filter or data changes, once map is ready
  useEffect(() => {
    const m = map.current
    if (!m || loading || !mapReady) return

    // Remove old markers
    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = []

    filteredIncidents.forEach(incident => {
      if (!incident.lat || !incident.lng) return
      const [color] = getDotColor(incident.injury)

      const el = document.createElement('div')
      el.style.cssText = `
        width: 10px; height: 10px; border-radius: 50%;
        background-color: ${color};
        border: 1.5px solid rgba(255,255,255,0.25);
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      `
      el.addEventListener('mouseenter', () => {
        el.style.transform = 'scale(1.8)'
        el.style.boxShadow = `0 0 8px ${color}`
      })
      el.addEventListener('mouseleave', () => {
        el.style.transform = 'scale(1)'
        el.style.boxShadow = 'none'
      })
      el.addEventListener('click', () => setSelected(incident))

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([incident.lng, incident.lat])
        .addTo(m)
      markersRef.current.push(marker)
    })
  }, [filteredIncidents, loading, mapReady])

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-gray-950 text-gray-400 gap-3">
        <div className="text-2xl">🗺️</div>
        <div className="text-sm">Set <code className="text-gray-300">NEXT_PUBLIC_MAPBOX_TOKEN</code> to enable the map.</div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full bg-gray-950">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Top bar */}
      <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-4 pointer-events-none z-10">
        {/* Filter buttons */}
        <div className="flex flex-wrap gap-2 pointer-events-auto">
          {COMPANIES.map(company => (
            <button
              key={company}
              onClick={() => setActiveFilter(company)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeFilter === company
                  ? 'bg-white text-gray-900 shadow-lg'
                  : 'bg-gray-900/80 text-gray-300 border border-gray-700 hover:border-gray-500'
              }`}
            >
              {company}
            </button>
          ))}
        </div>

        {/* Counter */}
        <div className="pointer-events-auto bg-gray-900/90 border border-gray-700 rounded-lg px-4 py-2 text-right shrink-0">
          <div className="text-white font-bold text-lg leading-tight">{filteredIncidents.length}</div>
          <div className="text-gray-400 text-xs">crashes reported since 2021</div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-8 left-4 bg-gray-900/90 border border-gray-700 rounded-lg px-3 py-2 z-10">
        <div className="text-gray-400 text-xs mb-1.5 font-semibold uppercase tracking-wider">Severity</div>
        {[
          { color: '#7F1D1D', label: 'Fatality' },
          { color: '#EF4444', label: 'Injury reported' },
          { color: '#EAB308', label: 'Property damage / no injury' },
          { color: '#6B7280', label: 'Unknown' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-gray-300 text-xs">{label}</span>
          </div>
        ))}
      </div>

      {/* Sidebar */}
      {selected && (
        <div className="absolute top-0 right-0 h-full w-80 max-w-[90vw] bg-gray-950/95 border-l border-gray-800 z-20 flex flex-col overflow-hidden">
          <div className="flex items-start justify-between p-5 border-b border-gray-800">
            <div>
              <div
                className="text-xs font-bold uppercase tracking-widest mb-1"
                style={{ color: COMPANY_COLORS[normalizeCompany(selected.company)] || '#fff' }}
              >
                {normalizeCompany(selected.company)}
              </div>
              <div className="text-white font-bold text-xl leading-tight">
                {selected.city}, {selected.state}
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-gray-500 hover:text-white transition-colors ml-3 mt-0.5 shrink-0"
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900 rounded-lg p-3">
                <div className="text-gray-500 text-xs mb-1">Date</div>
                <div className="text-white text-sm">{formatDate(selected.date)}</div>
              </div>
              <div className="bg-gray-900 rounded-lg p-3">
                <div className="text-gray-500 text-xs mb-1">Time</div>
                <div className="text-white text-sm">{selected.time || 'Unknown'}</div>
              </div>
            </div>

            {selected.crash_with && (
              <div className="bg-gray-900 rounded-lg p-3">
                <div className="text-gray-500 text-xs mb-1">Crashed into</div>
                <div className="text-white text-sm">{selected.crash_with}</div>
              </div>
            )}

            <div className="bg-gray-900 rounded-lg p-3">
              <div className="text-gray-500 text-xs mb-1">Injury Severity</div>
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: getDotColor(selected.injury)[0] }}
                />
                <div className="text-white text-sm">{selected.injury || 'Unknown'}</div>
              </div>
            </div>

            {selected.narrative && (
              <div>
                <div className="text-gray-500 text-xs mb-2 font-semibold uppercase tracking-wider">Incident Report</div>
                <p className="text-gray-300 text-sm leading-relaxed">{selected.narrative}</p>
              </div>
            )}

            <div className="text-gray-600 text-xs pt-2 border-t border-gray-800">
              Report ID: {selected.report_id}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-30">
          <div className="text-white text-sm tracking-wide">Loading incidents…</div>
        </div>
      )}
    </div>
  )
}
