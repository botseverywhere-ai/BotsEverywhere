import { useState } from 'react'
import { Button } from './Button'
import { downloadChartPng, type PngChart } from './chart-png'

/** Download PNG on your own org chart and work chart. */
export function ChartPngButton({
  chart,
  orgName,
  target,
}: {
  chart: PngChart
  /** The name saved in Organization Overview, never the folder. */
  orgName: string
  /** The chart as drawn now. */
  target: () => HTMLElement | null
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <>
      <Button
        variant="secondary"
        type="button"
        disabled={busy}
        onClick={() => {
          const node = target()
          if (!node) return
          setBusy(true)
          setFailed(false)
          downloadChartPng(node, orgName, chart)
            .catch(() => setFailed(true))
            .finally(() => setBusy(false))
        }}
      >
        Download PNG
      </Button>
      {failed ? <span className="chart-png-error" role="status">Could not save the PNG. Try again.</span> : null}
    </>
  )
}
