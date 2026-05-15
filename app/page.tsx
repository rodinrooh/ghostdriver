import dynamic from 'next/dynamic'

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false })

export default function Home() {
  return (
    <main className="w-screen h-screen overflow-hidden">
      <MapView />
    </main>
  )
}
