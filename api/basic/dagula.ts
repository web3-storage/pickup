import { Dagula } from 'dagula'
import { getLibp2p } from 'dagula/p2p.js'

export async function hasBlock (
  cid: string,
  peer = '/dns4/elastic.dag.house/tcp/443/wss/p2p/bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm'
): Promise<boolean> {
  const libp2p = await getLibp2p()

  const dagula = await Dagula.fromNetwork(libp2p, { peer })
  try {
    await dagula.getBlock(cid)
    return true
  } catch (err: any) {
    if (err.code === 'ERR_DONT_HAVE') {
      return false
    }
    throw err
  } finally {
    await libp2p.stop()
  }
}
