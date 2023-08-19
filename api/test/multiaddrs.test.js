import test from 'ava'
import { findUsableMultiaddrs } from '../basic/helper/multiaddr.js'

const fixture = [
  '/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/127.0.0.1/udp/4001/quic-v1/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/127.0.0.1/udp/4001/quic-v1/webtransport/certhash/uEiAcyORkzbKPHpd2Rq8px1APBfdnTJ1jzH10u92mYJAOMA/certhash/uEiBFkYB7Q0cp49VFSMY9ae8ffHaRJf7N0WXCGBkGp4KCIQ/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/127.0.0.1/udp/4001/quic/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/192.168.1.113/tcp/4001/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/192.168.1.113/udp/4001/quic-v1/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/192.168.1.113/udp/4001/quic-v1/webtransport/certhash/uEiAcyORkzbKPHpd2Rq8px1APBfdnTJ1jzH10u92mYJAOMA/certhash/uEiBFkYB7Q0cp49VFSMY9ae8ffHaRJf7N0WXCGBkGp4KCIQ/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/192.168.1.113/udp/4001/quic/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/45.76.79.40/udp/4001/quic-v1/p2p/12D3KooWGFLFZ9uYAqD8WschDcPDT4PgmsGzgvwrTdDmV4LD5kSe/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/45.76.79.40/udp/4001/quic/p2p/12D3KooWGFLFZ9uYAqD8WschDcPDT4PgmsGzgvwrTdDmV4LD5kSe/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/5.161.44.89/tcp/4001/p2p/12D3KooWSvYbdaYZmZucbkEHKDDoHNqCtkEMWdSm1z4udww6fyUM/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/5.161.44.89/udp/4001/quic/p2p/12D3KooWSvYbdaYZmZucbkEHKDDoHNqCtkEMWdSm1z4udww6fyUM/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip6/2a01:4ff:f0:ab6::1/tcp/4001/p2p/12D3KooWSvYbdaYZmZucbkEHKDDoHNqCtkEMWdSm1z4udww6fyUM/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip6/2a01:4ff:f0:ab6::1/udp/4001/quic/p2p/12D3KooWSvYbdaYZmZucbkEHKDDoHNqCtkEMWdSm1z4udww6fyUM/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip6/::1/tcp/4001/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip6/::1/udp/4001/quic-v1/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip6/::1/udp/4001/quic-v1/webtransport/certhash/uEiAcyORkzbKPHpd2Rq8px1APBfdnTJ1jzH10u92mYJAOMA/certhash/uEiBFkYB7Q0cp49VFSMY9ae8ffHaRJf7N0WXCGBkGp4KCIQ/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip6/::1/udp/4001/quic/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN'
]

const expected = [
  '/ip4/5.161.44.89/tcp/4001/p2p/12D3KooWSvYbdaYZmZucbkEHKDDoHNqCtkEMWdSm1z4udww6fyUM/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip4/5.161.44.89/udp/4001/quic/p2p/12D3KooWSvYbdaYZmZucbkEHKDDoHNqCtkEMWdSm1z4udww6fyUM/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip6/2a01:4ff:f0:ab6::1/tcp/4001/p2p/12D3KooWSvYbdaYZmZucbkEHKDDoHNqCtkEMWdSm1z4udww6fyUM/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/ip6/2a01:4ff:f0:ab6::1/udp/4001/quic/p2p/12D3KooWSvYbdaYZmZucbkEHKDDoHNqCtkEMWdSm1z4udww6fyUM/p2p-circuit/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN',
  '/p2p/12D3KooWADjHf2kyANQodg9z5sSdX4bGEMbWg7ojwu6SCyDAMtzN'
]

test('findUsableMultiaddrs', t => {
  const input = fixture.join(',')
  const res = findUsableMultiaddrs(input)
  t.is(res.length, 5)
  let i = 0
  for (const ma of expected) {
    t.is(res[i], ma)
    i++
  }
})
