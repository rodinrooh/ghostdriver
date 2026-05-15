'use client'

import { useEffect, useRef, useState } from 'react'
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

const CITIES = [
  { label: 'SF',      lat: 37.7749, lng: -122.4194 },
  { label: 'LA',      lat: 34.0522, lng: -118.2437 },
  { label: 'Phoenix', lat: 33.4484, lng: -112.0740 },
  { label: 'Dallas',  lat: 32.7767, lng: -96.7970  },
]

const COMPANY_COLORS: Record<string, string> = {
  Waymo: '#00C2FF',
  Zoox: '#FF6B35',
  Motional: '#A855F7',
  Avride: '#22C55E',
  Aurora: '#F59E0B',
  WeRide: '#EC4899',
}

function normalizeCompany(company: string): string {
  const lower = (company || '').toLowerCase()
  if (lower.includes('waymo')) return 'Waymo'
  if (lower.includes('zoox')) return 'Zoox'
  if (lower.includes('motional')) return 'Motional'
  if (lower.includes('avride')) return 'Avride'
  if (lower.includes('aurora')) return 'Aurora'
  if (lower.includes('weride')) return 'WeRide'
  return company
}

type Severity = 'fatal' | 'injury' | 'property' | 'unknown'

function getSeverity(injury: string): Severity {
  const lower = (injury || '').toLowerCase()
  if (lower.includes('fatal')) return 'fatal'
  if (lower.includes('minor') || lower.includes('moderate') || lower.includes('serious') ||
      (lower.includes('hospitalization') && !lower.includes('no injured'))) return 'injury'
  if (lower.includes('property') || lower.includes('no injured') || lower.includes('no injury')) return 'property'
  return 'unknown'
}

const SEV_COLOR: Record<Severity, string> = {
  fatal: '#ef4444',
  injury: '#f97316',
  property: '#eab308',
  unknown: '#6b7280',
}

const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
}

function formatDate(d: string): string {
  if (!d) return ''
  const m = d.match(/^([A-Z]{3})-(\d{4})$/)
  if (m && MONTH_MAP[m[1]] !== undefined)
    return new Date(+m[2], MONTH_MAP[m[1]], 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return d }
}

function seededOffset(seed: string, axis: number): number {
  let h = axis * 2654435761
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h ^ seed.charCodeAt(i), 2654435761)) >>> 0
  return ((h % 10000) / 10000 - 0.5) * 0.018
}

async function fetchAllIncidents(): Promise<Incident[]> {
  let all: Incident[] = [], from = 0
  while (true) {
    const { data, error } = await supabase
      .from('incidents').select('*').order('date', { ascending: false }).range(from, from + 999)
    if (error || !data?.length) break
    all = all.concat(data)
    if (data.length < 1000) break
    from += 1000
  }
  return all
}

declare global { interface Window { mapkit: any } }

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const annotationsRef = useRef<any[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selected, setSelected] = useState<Incident | null>(null)
  const [filter, setFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  // mapStage: 'idle' → 'scripting' → 'initing' → 'ready'
  const [mapStage, setMapStage] = useState<'idle' | 'scripting' | 'initing' | 'ready'>('idle')

  // Step 1: load MapKit JS script
  useEffect(() => {
    if (mapStage !== 'idle') return
    setMapStage('scripting')
    const s = document.createElement('script')
    s.src = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js'
    s.crossOrigin = 'anonymous'
    s.async = true
    s.onload = () => {
      setMapStage('initing')
      window.mapkit.init({
        authorizationCallback: (done: (t: string) => void) =>
          fetch('/api/mapkit-token').then(r => r.json()).then(d => done(d.token)),
        language: 'en',
      })
      window.mapkit.addEventListener('configuration-change', (e: any) => {
        if (e.status === 'Initialized') setMapStage('ready')
      })
    }
    s.onerror = (e) => console.error('MapKit script failed to load', e)
    document.head.appendChild(s)
  }, [mapStage])

  // Step 2: create map once MapKit is initialized
  useEffect(() => {
    if (mapStage !== 'ready' || !containerRef.current || mapRef.current) return
    const mk = window.mapkit
    const map = new mk.Map(containerRef.current, {
      colorScheme: mk.Map.ColorSchemes.Dark,
      showsPointsOfInterest: false,
      showsUserLocation: false,
      showsCompass: mk.FeatureVisibility.Hidden,
    })
    map.setRegionAnimated(
      new mk.CoordinateRegion(new mk.Coordinate(37.7749, -122.4194), new mk.CoordinateSpan(0.18, 0.28)),
      false
    )
    map.annotationForCluster = (cluster: any) => {
      const n = cluster.memberAnnotations.length
      return new mk.MarkerAnnotation(cluster.coordinate, {
        glyphText: n > 99 ? '99+' : String(n),
        color: '#dc2626',
        clusteringIdentifier: null,
        displayPriority: 1000,
      })
    }
    map.addEventListener('select', (e: any) => {
      if (e.annotation?.data) setSelected(e.annotation.data)
    })
    mapRef.current = map
    // Force annotation effect to re-run by updating a piece of state
    // (mapRef is a ref so changing it doesn't trigger re-render)
    setMapStage('ready') // same value, won't actually re-render — use a separate trigger below
  }, [mapStage])

  // Step 3: fetch data
  useEffect(() => {
    fetchAllIncidents().then(d => { setIncidents(d); setLoading(false) })
  }, [])

  const filtered = filter === 'All' ? incidents : incidents.filter(i => normalizeCompany(i.company) === filter)

  // Step 4: place annotations — runs when data changes OR when map becomes usable
  // We deliberately depend on `mapRef.current` indirectly via a flag updated after map creation
  useEffect(() => {
    const map = mapRef.current
    const mk = window.mapkit
    if (!map || !mk || loading || mapStage !== 'ready') return

    if (annotationsRef.current.length) {
      map.removeAnnotations(annotationsRef.current)
      annotationsRef.current = []
    }

    const anns = filtered.filter(i => i.lat && i.lng).map(incident => {
      const color = SEV_COLOR[getSeverity(incident.injury)]
      const lat = incident.lat + seededOffset(incident.report_id, 0)
      const lng = incident.lng + seededOffset(incident.report_id, 1)
      const factory = () => {
        const el = document.createElement('div')
        el.style.cssText = `width:9px;height:9px;border-radius:50%;background:${color};border:1.5px solid rgba(255,255,255,0.3);cursor:pointer;transition:transform .12s`
        el.onmouseenter = () => { el.style.transform = 'scale(2)'; el.style.zIndex = '9' }
        el.onmouseleave = () => { el.style.transform = 'scale(1)'; el.style.zIndex = '' }
        return el
      }
      return new mk.Annotation(
        new mk.Coordinate(lat, lng),
        factory,
        { clusteringIdentifier: 'crash', data: incident }
      )
    })
    map.addAnnotations(anns)
    annotationsRef.current = anns
  }, [filtered, loading, mapStage])

  function flyTo(lat: number, lng: number) {
    const map = mapRef.current, mk = window.mapkit
    if (!map || !mk) return
    map.setRegionAnimated(
      new mk.CoordinateRegion(new mk.Coordinate(lat, lng), new mk.CoordinateSpan(0.18, 0.28)),
      true
    )
  }

  const comp = selected ? normalizeCompany(selected.company) : ''
  const sev: Severity = selected ? getSeverity(selected.injury) : 'unknown'

  return (
    <div className="relative w-full h-full bg-black">
      <div ref={containerRef} className="w-full h-full" />

      {/* Top controls */}
      <div className="absolute top-4 left-4 right-4 flex flex-col gap-2 pointer-events-none z-10">
        <div className="flex items-start justify-between gap-3">
          {/* Company filters */}
          <div className="flex flex-wrap gap-1.5 pointer-events-auto">
            {COMPANIES.map(c => (
              <button key={c} onClick={() => setFilter(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shadow-lg ${
                  filter === c
                    ? 'bg-white text-gray-900'
                    : 'bg-black/70 text-gray-300 border border-white/10 hover:border-white/30 backdrop-blur-sm'
                }`}>
                {c}
              </button>
            ))}
          </div>
          {/* Counter */}
          <div className="pointer-events-auto bg-black/70 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-2 text-right shrink-0 shadow-lg">
            <div className="text-white font-bold text-xl leading-tight tabular-nums">{filtered.length}</div>
            <div className="text-gray-500 text-xs">crashes since 2021</div>
          </div>
        </div>

        {/* City jump buttons */}
        <div className="flex gap-1.5 pointer-events-auto">
          {CITIES.map(({ label, lat, lng }) => (
            <button key={label} onClick={() => flyTo(lat, lng)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-black/70 text-gray-400 border border-white/10 hover:border-white/30 hover:text-white backdrop-blur-sm transition-all shadow-lg">
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-4 bg-black/70 backdrop-blur-sm border border-white/10 rounded-xl px-3.5 py-3 z-10 shadow-lg">
        <div className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest mb-2">Severity</div>
        {(['fatal', 'injury', 'property', 'unknown'] as Severity[]).map(k => (
          <div key={k} className="flex items-center gap-2 mb-1.5 last:mb-0">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: SEV_COLOR[k] }} />
            <span className="text-gray-400 text-xs capitalize">
              {k === 'property' ? 'Property damage' : k === 'unknown' ? 'Unknown' : k.charAt(0).toUpperCase() + k.slice(1)}
            </span>
          </div>
        ))}
      </div>

      {/* Sidebar */}
      {selected && (
        <div className="absolute top-0 right-0 h-full w-[360px] max-w-[90vw] flex flex-col z-20 bg-[#0a0a0a] border-l border-white/8 shadow-2xl">
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-white/8 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: COMPANY_COLORS[comp] || '#fff' }} />
                <span className="text-[11px] font-semibold uppercase tracking-widest truncate" style={{ color: COMPANY_COLORS[comp] || '#aaa' }}>{comp}</span>
              </div>
              <div className="text-white font-bold text-[22px] leading-tight">{selected.city}, {selected.state}</div>
              <div className="text-gray-500 text-sm mt-0.5">
                {formatDate(selected.date)}{selected.time ? ` · ${selected.time}` : ''}
              </div>
            </div>
            <button onClick={() => setSelected(null)}
              className="ml-3 mt-0.5 shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-500 hover:text-white transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M1 1l10 10M11 1L1 11" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {/* Severity */}
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: `${SEV_COLOR[sev]}15`, border: `1px solid ${SEV_COLOR[sev]}25` }}>
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: SEV_COLOR[sev] }} />
              <div>
                <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold">Injury Severity</div>
                <div className="text-sm font-semibold mt-0.5" style={{ color: SEV_COLOR[sev] }}>
                  {selected.injury || 'Unknown'}
                </div>
              </div>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-2">
              {selected.crash_with && (
                <div className="col-span-2 bg-white/[0.04] rounded-xl p-3.5">
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-1">Crashed into</div>
                  <div className="text-white text-sm font-medium">{selected.crash_with}</div>
                </div>
              )}
              <div className="bg-white/[0.04] rounded-xl p-3.5">
                <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-1">Operator</div>
                <div className="text-white text-sm font-medium">{comp}</div>
              </div>
              <div className="bg-white/[0.04] rounded-xl p-3.5">
                <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-1">Location</div>
                <div className="text-white text-sm font-medium">{selected.city}, {selected.state}</div>
              </div>
            </div>

            {/* Narrative */}
            {selected.narrative && (
              <div className="bg-white/[0.04] rounded-xl p-3.5">
                <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2">Incident Report</div>
                <p className="text-gray-300 text-[13px] leading-relaxed">{selected.narrative}</p>
              </div>
            )}

            <div className="pt-1 pb-2">
              <span className="text-[10px] text-gray-700 font-mono">NHTSA #{selected.report_id}</span>
            </div>
          </div>
        </div>
      )}

      {(loading || mapStage !== 'ready') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-30 gap-3">
          <div className="text-white/40 text-xs tracking-widest uppercase">
            {mapStage === 'idle' || mapStage === 'scripting' ? 'Loading map…' :
             mapStage === 'initing' ? 'Initializing…' : 'Loading crashes…'}
          </div>
        </div>
      )}
    </div>
  )
}
