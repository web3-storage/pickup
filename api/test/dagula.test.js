import * as dagular from '../basic/dagula.js'
import test from 'ava'

test('hasBlock', async t => {
  const cid = 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354'
  const peer = '/dns4/elastic.dag.house/tcp/443/wss/p2p/bafzbeibhqavlasjc7dvbiopygwncnrtvjd2xmryk5laib7zyjor6kf3avm'
  t.true(await dagular.hasBlock(cid, peer))

  const noHas = 'bafkreianhj7sk3udthzisqdhtjlkm4bwenztg3s627dbm3gfaerzztzgau'
  t.false(await dagular.hasBlock(noHas, peer))
})
