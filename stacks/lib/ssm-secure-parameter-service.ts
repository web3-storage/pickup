// SDK is needed because cloudformation doesn't support secure strings
import aws from 'aws-sdk'
const ssm = new aws.SSM()

export class SSMSecureParameterService {
  static putIfNotExists(parameterName: string) {
    return ssm.putParameter({
      Name: parameterName,
      Type: 'SecureString',
      Value: 'changeMe',
      Overwrite: false, // TODO: Is this already enough to do nothing if already exists?
    })
  }

  //TODO: Remove param
}
