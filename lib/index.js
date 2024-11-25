'use strict';

const AWS = require('aws-sdk');
const diff = require('json-diff').diffString;
const fs = require('fs-promise');
const path = require('path');

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      diff: {
        usage: 'Compares local AWS CloudFormation templates against deployed ones',
        lifecycleEvents: ['diff'],
      },
      options: {
        package: {
          usage: 'Path of the deployment package',
          type: 'string',
          shortcut: 'p'
        },
      },
    };

    this.hooks = {
      'before:diff:diff': this.downloadTemplate.bind(this),
      'diff:diff': this.diff.bind(this),
    };

    this.options.stage = this.options.stage
      || (this.serverless.service.defaults && this.serverless.service.defaults.stage)
      || (this.serverless.service.provider && this.serverless.service.provider.stage)
      || 'dev';

    this.options.region = this.options.region
      || (this.serverless.service.defaults && this.serverless.service.defaults.region)
      || (this.serverless.service.provider && this.serverless.service.provider.region)
      || 'us-east-1';

    this.options['aws-profile'] = this.options['aws-profile']
      || (this.serverless.service.defaults && this.serverless.service.defaults['aws-profile'])
      || (this.serverless.service.provider && this.serverless.service.provider['aws-profile'])
      || 'default';

    this.options.package = this.options.package || '.serverless';

    AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: this.options['aws-profile'] });

    AWS.config.update({ region: this.options.region });

    this.cloudFormation = new AWS.CloudFormation();
    this.localTemplate = path.join(this.options.package, 'cloudformation-template-update-stack.json');
    this.orgTemplate = path.join(this.options.package, 'cloudformation-template-update-stack.org.json');
  }

  downloadTemplate() {
    let stackName;

    const { orgTemplate } = this;

    if (this.serverless.service.provider
      && typeof this.serverless.service.provider.stackName !== 'undefined'
      && this.serverless.service.provider.stackName !== '') {
      stackName = this.serverless.service.provider.stackName;
    } else {
      stackName = `${this.serverless.service.service}-${this.options.stage}`;
    }

    if (this.serverless.service.provider
      && typeof this.serverless.service.provider.preV1Resources !== 'undefined'
      && this.serverless.service.provider.preV1Resources === true) {
      stackName += '-r';
    }

    const params = {
      StackName: stackName,
      TemplateStage: 'Processed',
    };

    this.serverless.cli.log('Downloading currently deployed template');

    return this.cloudFormation.getTemplate(params).promise()
      .then((data) => {
        let templateBody = JSON.parse(data.TemplateBody);
        templateBody = JSON.stringify(templateBody, null, 2);

        return fs.writeFile(orgTemplate, templateBody)
          .then(() => {
            console.log('Downloaded currently deployed template');
            return Promise.resolve();
          });
      })
      .catch((err) => Promise.reject(err.message));
  }

  diff() {
    const { localTemplate, orgTemplate } = this;

    this.serverless.cli.log('Running diff against deployed template');

    return fs.stat(localTemplate)
      .then(() => {
        const orgTemplateJson = JSON.parse(fs.readFileSync(orgTemplate, 'utf8'));
        const localTemplateJson = JSON.parse(fs.readFileSync(localTemplate, 'utf8'));
        const differences = diff(orgTemplateJson, localTemplateJson) || {};

        if (Object.entries(differences).length === 0) {
          console.log('Resource templates are equal');
        } else {
          console.log(differences);
        }

        return Promise.resolve(differences);
      })
      .catch((err) => {
        if (err.code === 'ENOENT') {
          const errorPrefix = `${localTemplate} could not be found:`;
          return Promise.reject(`${errorPrefix} run "sls deploy --noDeploy" first.`);
        }
        return Promise.reject(err);
      });
  }
}

module.exports = ServerlessPlugin;
