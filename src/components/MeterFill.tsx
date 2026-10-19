import { useLayoutEffect, useRef } from 'react'

/** Sets --meter on the element. Dynamic widths stay off the style prop. */
export function MeterFill({ percent }: { percent: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    ref.current?.style.setProperty('--meter', `${percent}%`)
  }, [percent])
  return <span ref={ref} className="meter-fill" />
}
