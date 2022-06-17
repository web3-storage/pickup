import { StackContext, Api, Table } from "@serverless-stack/resources"
import { RemovalPolicy } from "aws-cdk-lib"

export function PinningServiceStack({ stack }: StackContext) {
  const table = new Table(stack, "PinStatusv2", {
    fields: {
      requestid: "string",
      userid: "string"
    },
    primaryIndex: { 
      partitionKey: "userid",
      sortKey: "requestid"
    },
    dynamodbTable: {
      removalPolicy: RemovalPolicy.DESTROY,
    }
  })

  const api = new Api(stack, "api", {
    cors: true,
    defaults: {
      function: {
        permissions: [table],
        environment: {
          TABLE_NAME: table.tableName,
        },
      },
    },
    routes: {
      "GET    /pins": "functions/PinningService.handler",
      "POST   /pins": "functions/PinningService.handler",
      "GET    /pins/{requestId}": "functions/PinningService.handler",
      "POST   /pins/{requestId}": "functions/PinningService.handler",
      "DELETE /pins/{requestId}": "functions/PinningService.handler",
    }
    // adding a 404 default route handler means CORS OPTION not work without extra config.
  })

  // Show the endpoint in the output
  stack.addOutputs({
    ApiEndpoint: api.url,
  })
}
