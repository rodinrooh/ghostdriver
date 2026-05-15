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

type SeverityLevel = 'fatal' | 'injury' | 'property' | 'unknown'

function getSeverity(injury: string): SeverityLevel {
  const lower = (injury || '').toLowerCase()
  if (lower.includes('fatal')) return 'fatal'
  if (lower.includes('minor') || lower.includes('moderate') || lower.includes('serious') ||
      (lower.includes('hospitalization') && !lower.includes('no injured'))) return 'injury'
  if (lower.includes('property') || lower.includes('no injured') || lower.includes('no injury')) return 'property'
  return 'unknown'
}

const SEVERITY_COLOR: Record<SeverityLevel, string> = {
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
  if (m && MONTH_MAP[m[1]] !== undefined) {
    return new Date(+m[2], MONTH_MAP[m[1]], 1)
      .toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
  }
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return d }
}

// Deterministic per-incident jitter so same-city incidents spread apart visually
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
  const [mapReady, setMapReady] = useState(false)

  // Load MapKit JS script once
  useEffect(() => {
    if (window.mapkit) { setMapReady(true); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js'
    s.crossOrigin = 'anonymous'
    s.async = true
    s.onload = () => {
      window.mapkit.init({
        authorizationCallback: (done: (t: string) => void) =>
          fetch('/api/mapkit-token').then(r => r.json()).then(d => done(d.token)),
        language: 'en',
      })
      window.mapkit.addEventListener('configuration-change', (e: any) => {
        if (e.status === 'Initialized') setMapReady(true)
      })
    }
    document.head.appendChild(s)
  }, [])

  // Init map once MapKit is ready
  useEffect(() => {
    if (!mapReady || !containerRef.current || mapRef.current) return
    const mk = window.mapkit
    const map = new mk.Map(containerRef.current, {
      colorScheme: mk.Map.ColorSchemes.Dark,
      showsPointsOfInterest: false,
      showsUserLocation: false,
      showsCompass: mk.FeatureVisibility.Hidden,
    })
    map.setRegionAnimated(
      new mk.CoordinateRegion(new mk.Coordinate(37, -97), new mk.CoordinateSpan(28, 50)),
      false
    )
    // Cluster badge
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
  }, [mapReady])

  // Fetch data
  useEffect(() => {
    fetchAllIncidents().then(d => { setIncidents(d); setLoading(false) })
  }, [])

  const filtered = filter === 'All' ? incidents : incidents.filter(i => normalizeCompany(i.company) === filter)

  // Sync annotations when filter/data/map changes
  useEffect(() => {
    const map = mapRef.current, mk = window.mapkit
    if (!map || !mk || loading) return
    if (annotationsRef.current.length) { map.removeAnnotations(annotationsRef.current); annotationsRef.current = [] }

    const anns = filtered.filter(i => i.lat && i.lng).map(incident => {
      const sev = getSeverity(incident.injury)
      const color = SEVERITY_COLOR[sev]
      const lat = incident.lat + seededOffset(incident.report_id, 0)
      const lng = incident.lng + seededOffset(incident.report_id, 1)

      const factory = () => {
        const el = document.createElement('div')
        el.style.cssText = `width:9px;height:9px;border-radius:50%;background:${color};border:1.5px solid rgba(255,255,255,0.35);cursor:pointer;transition:transform .12s`
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
  }, [filtered, loading, mapReady])

  const comp = selected ? normalizeCompany(selected.company) : ''
  const sev = selected ? getSeverity(selected.injury) : 'unknown'

  return (
    <div className="relative w-full h-full bg-black">
      <div ref={containerRef} className="w-full h-full" />

      {/* Filter bar + counter */}
      <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-3 pointer-events-none z-10">
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
        <div className="pointer-events-auto bg-black/70 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-2 text-right shrink-0 shadow-lg">
          <div className="text-white font-bold text-xl leading-tight tabular-nums">{filtered.length}</div>
          <div className="text-gray-500 text-xs">crashes since 2021</div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-4 bg-black/70 backdrop-blur-sm border border-white/10 rounded-xl px-3.5 py-3 z-10 shadow-lg">
        <div className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest mb-2">Severity</div>
        {([['fatal', 'Fatal'], ['injury', 'Injury'], ['property', 'Property damage'], ['unknown', 'Unknown']] as [SeverityLevel, string][]).map(([k, label]) => (
          <div key={k} className="flex items-center gap-2 mb-1.5 last:mb-0">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: SEVERITY_COLOR[k] }} />
            <span className="text-gray-400 text-xs">{label}</span>
          </div>
        ))}
      </div>

      {/* Sidebar */}
      {selected && (
        <div className="absolute top-0 right-0 h-full w-[360px] max-w-[90vw] flex flex-col z-20 bg-[#0a0a0a] border-l border-white/8">
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-white/8 shrink-0">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full" style={{ background: COMPANY_COLORS[comp] || '#fff' }} />
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: COMPANY_COLORS[comp] || '#fff' }}>
                  {comp}
                </span>
              </div>
              <div className="text-white font-bold text-[22px] leading-tight">
                {selected.city}, {selected.state}
              </div>
              <div className="text-gray-500 text-sm mt-0.5">{formatDate(selected.date)}{selected.time ? ` · ${selected.time}` : ''}</div>
            </div>
            <button onClick={() => setSelected(null)}
              className="mt-0.5 ml-3 shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-500 hover:text-white transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 1l10 10M11 1L1 11" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Severity badge */}
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl" style={{ background: `${SEVERITY_COLOR[sev]}18`, border: `1px solid ${SEVERITY_COLOR[sev]}30` }}>
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEVERITY_COLOR[sev] }} />
              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Injury Severity</div>
                <div className="text-sm font-semibold mt-0.5" style={{ color: SEVERITY_COLOR[sev] }}>
                  {selected.injury || 'Unknown'}
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2">
              {selected.crash_with && (
                <div className="col-span-2 bg-white/4 rounded-xl p-3.5">
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-1">Crashed into</div>
                  <div className="text-white text-sm font-medium">{selected.crash_with}</div>
                </div>
              )}
              <div className="bg-white/4 rounded-xl p-3.5">
                <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-1">Company</div>
                <div className="text-white text-sm font-medium">{comp}</div>
              </div>
              <div className="bg-white/4 rounded-xl p-3.5">
                <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-1">Location</div>
                <div className="text-white text-sm font-medium">{selected.city}, {selected.state}</div>
              </div>
            </div>

            {/* Narrative */}
            {selected.narrative && (
              <div>
                <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2.5">Incident Report</div>
                <p className="text-gray-300 text-[13px] leading-[1.7] tracking-[0.01em]">{selected.narrative}</p>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-white/6">
              <span className="text-[10px] text-gray-700 font-mono">NHTSA #{selected.report_id}</span>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-30">
          <div className="text-white/60 text-sm tracking-widest uppercase">Loading crashes…</div>
        </div>
      )}
    </div>
  )
}
