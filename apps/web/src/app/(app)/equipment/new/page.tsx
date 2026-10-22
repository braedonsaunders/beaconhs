import { redirect } from 'next/navigation'

export default function NewEquipmentPage() {
  redirect('/equipment?drawer=new')
}
