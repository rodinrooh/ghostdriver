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

function getDotColor(injury: string): string {
  if (!injury) return '#6B7280'
  const lower = injury.toLowerCase()
  if (lower.includes('no') && (lower.includes('injury') || lower.includes('treatment'))) return '#EAB308'
  if (lower === 'none' || lower === 'property damage only' || lower.includes('property')) return '#EAB308'
  if (lower.includes('unknown') || lower.includes('not')) return '#6B7280'
  return '#EF4444'
}

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selected, setSelected] = useState<Incident | null>(null)
  const [activeFilter, setActiveFilter] = useState('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadIncidents() {
      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .order('date', { ascending: false })
      if (!error && data) setIncidents(data)
      setLoading(false)
    }
    loadIncidents()
  }, [])

  const filteredIncidents = activeFilter === 'All'
    ? incidents
    : incidents.filter(i => i.company?.toLowerCase().includes(activeFilter.toLowerCase()))

  useEffect(() => {
    if (!mapContainer.current || map.current) return

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98, 38],
      zoom: 4,
    })

    map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right')

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m || loading) return

    const addMarkers = () => {
      // Remove existing markers
      document.querySelectorAll('.ghost-marker').forEach(el => el.remove())

      filteredIncidents.forEach(incident => {
        if (!incident.lat || !incident.lng) return

        const el = document.createElement('div')
        el.className = 'ghost-marker'
        el.style.cssText = `
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: ${getDotColor(incident.injury)};
          border: 1.5px solid rgba(255,255,255,0.3);
          cursor: pointer;
          transition: transform 0.15s ease;
        `
        el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.6)' })
        el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)' })
        el.addEventListener('click', () => setSelected(incident))

        new mapboxgl.Marker({ element: el })
          .setLngLat([incident.lng, incident.lat])
          .addTo(m)
      })
    }

    if (m.isStyleLoaded()) {
      addMarkers()
    } else {
      m.once('load', addMarkers)
    }

    return () => {
      document.querySelectorAll('.ghost-marker').forEach(el => el.remove())
    }
  }, [filteredIncidents, loading])

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch { return dateStr }
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
          { color: '#EF4444', label: 'Injury reported' },
          { color: '#EAB308', label: 'Property damage only' },
          { color: '#6B7280', label: 'Unknown / no damage' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-gray-300 text-xs">{label}</span>
          </div>
        ))}
      </div>

      {/* Sidebar */}
      {selected && (
        <div className="absolute top-0 right-0 h-full w-80 max-w-full bg-gray-950/95 border-l border-gray-800 z-20 flex flex-col overflow-hidden">
          <div className="flex items-start justify-between p-5 border-b border-gray-800">
            <div>
              <div
                className="text-xs font-bold uppercase tracking-widest mb-1"
                style={{ color: COMPANY_COLORS[selected.company] || '#fff' }}
              >
                {selected.company}
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
                  style={{ backgroundColor: getDotColor(selected.injury) }}
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
          <div className="text-white text-sm">Loading incidents...</div>
        </div>
      )}
    </div>
  )
}
