import { Redirect } from 'expo-router'

export default function Index() {
  // kasneje: preveri auth
  return <Redirect href="/login" />
}
