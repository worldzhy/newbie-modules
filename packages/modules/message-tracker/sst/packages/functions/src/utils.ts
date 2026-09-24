export function checkEmailMessageBody(sqsMessageBody: any) {
  if (
    !('toAddress' in sqsMessageBody) ||
    !('subject' in sqsMessageBody) ||
    !('html' in sqsMessageBody) ||
    !('text' in sqsMessageBody) ||
    !sqsMessageBody.toAddress ||
    !sqsMessageBody.subject ||
    !sqsMessageBody.html ||
    !sqsMessageBody.text
  ) {
    return false;
  } else {
    return true;
  }
}

export function checkTextMessageBody(sqsMessageBody: any) {
  if (
    !('phoneNumber' in sqsMessageBody) ||
    !('text' in sqsMessageBody) ||
    !sqsMessageBody.phoneNumber ||
    !sqsMessageBody.text
  ) {
    return false;
  } else {
    return true;
  }
}
