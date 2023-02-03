# IPFS sidecar docker image

The Dockerfile in this dir builds a custom kubo image with the config overrides.

We have to provided our own image rather than using the public one as:

1. The configuration changes we want can only be set this way. See [#9](https://github.com/olizilla/pickup/issues/9)
2. Trying to pull from dockerhub hits rate limits. By providing our own image we user the AWS registry. See [#20](https://github.com/olizilla/pickup/issues/20)

The config changes are defined in ipfs-config.sh
