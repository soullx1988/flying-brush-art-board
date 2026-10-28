import { useRef, useState } from 'react'
import { Button, Input, Select } from '@ttqtt/liquid-glass-react'
import type { DesignFields } from './commerce-overview-model'

export function CommerceDesignEditor({ value, onSave }: { value: DesignFields; onSave(change: DesignFields, expected: DesignFields): void }) {
  const expected = useRef(value)
  const [title,setTitle]=useState(value.title),[goal,setGoal]=useState(value.goal),[measure,setMeasure]=useState(value.measure),[decision,setDecision]=useState(value.decision)
  return <div className="design-map-form" onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}><label>设计目标<Input value={title} onChange={e=>setTitle(e.currentTarget.value)}/></label><label>预期改变<Input value={goal} onChange={e=>setGoal(e.currentTarget.value)}/></label><label>验证什么<Input value={measure} onChange={e=>setMeasure(e.currentTarget.value)}/></label><label>确认状态<Select value={decision} options={[{value:'draft',label:'待确认'},{value:'confirmed',label:'已确认'}]} onChange={v=>setDecision(v as DesignFields['decision'])}/></label><Button variant="accent" disabled={!title.trim()} onClick={()=>onSave({title:title.trim(),goal,measure,decision},expected.current)}>保存设计</Button></div>
}
