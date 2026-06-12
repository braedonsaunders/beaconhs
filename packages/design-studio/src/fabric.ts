export async function loadFabric(): Promise<any> {
  return import('fabric')
}
