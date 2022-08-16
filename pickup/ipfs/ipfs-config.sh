#!/bin/sh
## The shell in the go-ipfs container is busybox, so a version of ash
## Shellcheck might warn on things POSIX sh cant do, but ash can
## In Shellcheck, ash is an alias for dash, but busybox ash can do more than dash 
## https://github.com/koalaman/shellcheck/blob/master/src/ShellCheck/Data.hs#L134

# dont add provider records to the dht
ipfs config --json Experimental.StrategicProviding true

# as per gateways
ipfs config --json Swarm.DisableBandwidthMetrics true

# no MDNS plz
ipfs config --json Discovery.MDNS.Enabled false

# plz fail early if bits get flipped in blockstore
ipfs config --json Datastore.HashOnRead true

# maybe have go faster dht... but makes it unusable for the first 5 mins!! https://github.com/ipfs/kubo/blob/master/docs/experimental-features.md#accelerated-dht-client
# ipfs config --json Experimental.AcceleratedDHTClient true