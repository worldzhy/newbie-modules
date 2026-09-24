import {Injectable} from '@nestjs/common';
import {auth, forms, forms_v1} from '@googleapis/forms';
import {ConfigService} from '@nestjs/config';

@Injectable()
export class GoogleFormService {
  private client: forms_v1.Forms;

  constructor(private readonly config: ConfigService) {
    // Create a new JWT client using the key file downloaded from the Google Developer Console.
    const authObj = new auth.GoogleAuth({
      keyFile: this.config.getOrThrow<string>('microservices.googleapis.credentials.serviceAccount'),
      scopes: ['https://www.googleapis.com/auth/forms'],
    });

    this.client = forms({version: 'v1', auth: authObj});
  }

  async getFormItems(formId: string) {
    try {
      const result = await this.client.forms.get({formId});
      return result.data.items || [];
    } catch (error) {
      throw error;
    }
  }

  async getFormResponses(formId: string) {
    try {
      const result = await this.client.forms.responses.list({formId});

      const responses = result.data.responses;
      if (responses) {
        for (let i = 0; i < responses.length; i++) {
          const response = responses[i];
          const answers = response.answers;
          for (let key in answers) {
            const answer = answers[key];
            answer.questionId;
          }
        }
      }

      return responses || [];
    } catch (error) {
      throw error;
    }
  }

  /* End */
}
