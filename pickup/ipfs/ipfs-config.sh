#!/bin/sh
## The shell in the kubo container is busybox, so a version of ash
## Shellcheck might warn on things POSIX sh cant do, but ash can
## In Shellcheck, ash is an alias for dash, but busybox ash can do more than dash 
## https://github.com/koalaman/shellcheck/blob/master/src/ShellCheck/Data.hs#L134

# kubo config docs: https://github.com/ipfs/kubo/blob/master/docs/config.md

# dont announce localhost ips, DisableNatPortMap: true, Discovery.MDNS.Enabled false: false
ipfs config profile apply server

# use the IPFS DHT and parallel HTTP routers for additional speed. (but without running a DHT server.)
ipfs config --json Routing.Type "autoclient"

# dont add provider records to the dht... e-ipfs will do that.
ipfs config --json Experimental.StrategicProviding true

# as per gateways
ipfs config --json Swarm.DisableBandwidthMetrics true

# we manually connect to nodes that send `origins` so we dont need loads of connections here.
ipfs config --json Swarm.ConnMgr.HighWater 100
ipfs config --json Swarm.ConnMgr.LowWater 50

# plz fail early if bits get flipped in blockstore
ipfs config --json Datastore.HashOnRead true

# set `Datastore.Spec.mounts.[0].child.sync false` to avoid needless extra sync calls for much perf boost.
# otherwise the rest is defaults, but we can't use ipfs config to set items in an array!
ipfs config --json Datastore.Spec.mounts '[
  {
    "child": {
      "path": "blocks",
      "shardFunc": "/repo/flatfs/shard/v1/next-to-last/2",
      "sync": false,
      "type": "flatfs"
    },
    "mountpoint": "/blocks",
    "prefix": "flatfs.datastore",
    "type": "measure"
  },
  {
    "child": {
      "compression": "none",
      "path": "datastore",
      "type": "levelds"
    },
    "mountpoint": "/",
    "prefix": "leveldb.datastore",
    "type": "measure"
  }
]'

# maybe have go faster dht... but makes it unusable for the first 5 mins!! https://github.com/ipfs/kubo/blob/master/docs/experimental-features.md#accelerated-dht-client
# ipfs config --json Experimental.AcceleratedDHTClient true
