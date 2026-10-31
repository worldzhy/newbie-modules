import { Injectable } from "@nestjs/common";

@Injectable()
export class ProductMessageTracker_Stack {
  static getStackParams() {
    return {
      // Empty credential placeholders: the caller must supply the real
      // endpoint and secret, nothing is pre-filled with a usable default.
      DatabaseHost: "",
      DatabasePort: "5432",
      DatabaseMasterUsername: "",
      DatabaseMasterUserPassword: "",
      DatabaseName: "postgres",
      SESIdentityARN: "",
      FromAddress: "",
    };
  }

  static checkStackParams(params: object) {
    if (params) {
      return true;
    } else {
      return false;
    }
  }

  static getStackOutputKeys() {
    return ["EmailQueueUrl"];
  }

  static getStackTemplate() {
    return "quickstart-message-tracker/templates/message-tracker.template.json";
  }
}
