import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

const REGION = "us-east-1"
const BUCKET_NAME = `aws-codedeploy-${REGION}`;

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const NextJSBucket = new s3.Bucket(this, "NextJSBucket", {})

    const NextJSLogGroup = new logs.LogGroup(this, "NextJSLogGroup", {})

    const NextJSProject = new codebuild.Project(this, "NextJSProject", {      
      badge : true,
      artifacts: codebuild.Artifacts.s3({
        bucket : NextJSBucket,
        packageZip: true,
        includeBuildId : false,        
      }),
      concurrentBuildLimit : 1,      
      source: codebuild.Source.gitHub({
        owner : "nagolyhprum",
        repo : "codestar",
        branchOrRef : "main",     
        webhook: true,
        webhookTriggersBatchBuild: false,                
        webhookFilters: [
          codebuild.FilterGroup
            .inEventOf(codebuild.EventAction.PUSH)
            .andBranchIs('main')
        ],
      }),
      logging : {
        cloudWatch : {
          enabled : true,
          logGroup: NextJSLogGroup
        }
      }, 
      environment : {        
        buildImage : codebuild.LinuxBuildImage.STANDARD_6_0,
        privileged : true,        
      },      
    })

    const NextJSVpc = new ec2.Vpc(this, "NextJSVpc", {})

    const NextJSSecurityGroup = new ec2.SecurityGroup(this, "NextJSSecurityGroup", {
      vpc : NextJSVpc,            
      allowAllOutbound : true,      
    })
    
    NextJSSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), "In")
    // NextJSSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), "Out")

    const NextJS = new ec2.Instance(this, "NextJS", {
      vpc : NextJSVpc,
      instanceType: new ec2.InstanceType("t2.nano"),
      machineImage: new ec2.AmazonLinuxImage(),
      securityGroup : NextJSSecurityGroup,      
      keyName : "NextJS",      
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },      
      init: ec2.CloudFormationInit.fromConfigSets({
        configSets: {
          default: ['yumPreinstall'],
        },
        configs: {
          yumPreinstall: new ec2.InitConfig([
            ec2.InitPackage.yum('ruby'),
            ec2.InitPackage.yum('wget'),
            ec2.InitCommand.argvCommand(["cd", "/home/ec2-user"]),
            // https://aws-codedeploy-us-east-1.s3.us-east-1.amazonaws.com/latest/install
            ec2.InitCommand.argvCommand(["wget", `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/latest/install`]),
            ec2.InitCommand.argvCommand(["chmod", "+x", "./install"]),
            ec2.InitCommand.argvCommand(["sudo", "./install", "auto"]),
          ]),
        },
      }),
    })
    cdk.Tags.of(NextJS).add('version', '1.0.0');
    NextJSBucket.grantReadWrite(NextJS)

    const NextJSEIP = new ec2.CfnEIP(this, "NextJSEIP", {
      instanceId : NextJS.instanceId,            
    })

    const NextJSApplication = new codedeploy.ServerApplication(this, "NextJSApplication", {})

    const NextJSDeploymentGroup = new codedeploy.ServerDeploymentGroup(this, "NextJSDeploymentGroup", {
      application : NextJSApplication,   
      ec2InstanceTags : new codedeploy.InstanceTagSet({
        "version" : ["1.0.0"]
      }),
    })
  }
}
