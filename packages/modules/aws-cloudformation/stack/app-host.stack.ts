import { APP_HOST_TEMPLATE } from "./app-host.template";

/**
 * The single stack type this module provisions. Adding another topology means
 * adding another stack definition, not branching inside the primitives.
 */
export const AppHostStack = {
  type: "APP_HOST" as const,

  /** Example parameters shown to callers; every key mirrors a template parameter. */
  getStackParams(): Record<string, string> {
    return {
      ProjectKey: "",
      EnvironmentName: "",
      InstanceType: "t3.small",
      AmiId: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64",
      VpcId: "",
      SubnetIds: "",
      Domain: "",
      HostedZoneId: "",
      RepositoryFullName: "",
      Branch: "main",
      GitHubOidcProviderArn: "",
      BackupBucketName: "",
    };
  },

  getStackOutputKeys(): string[] {
    return Object.keys(APP_HOST_TEMPLATE.Outputs);
  },

  getStackTemplateBody(): string {
    return JSON.stringify(APP_HOST_TEMPLATE);
  },
};

export type AppHostStackType = typeof AppHostStack.type;
