import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { CodeDeployServerDeployAction, S3SourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

const HeaderName = "X-Secret";
const HeaderValue = "958f2310-521b-11ed-bdc3-0242ac120002";

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const NextJSBucket = new s3.Bucket(this, "NextJSBucket", {
      versioned : true
    })

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

    const NextJSVpc = new ec2.Vpc(this, "NextJSVpc", {natGateways: 1})

    const NextJSSecurityGroup = new ec2.SecurityGroup(this, "NextJSSecurityGroup", {
      vpc : NextJSVpc,    
    })
    
    NextJSSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), "In")

    const NextJSAutoScalingGroup = new autoscaling.AutoScalingGroup(this, "NextJSAutoScalingGroup", {
      vpc : NextJSVpc,
      instanceType: new ec2.InstanceType("t3.nano"),
      machineImage: new ec2.AmazonLinuxImage(),
      securityGroup : NextJSSecurityGroup,      
      keyName : "NextJS",                
    })

    // https://bobbyhadz.com/blog/aws-cdk-application-load-balancer
    const NextJSLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'NextJSLoadBalancer', {
      vpc: NextJSVpc,
      internetFacing: true,      
    });
    
    // loganmurphy.us, *.loganmurphy.us
    const NextJSCertificate = Certificate.fromCertificateArn(this, "NextJSCertificate", "arn:aws:acm:us-east-1:796357290755:certificate/e84949cd-9346-4643-a664-98fb4e981766")

    const Http = NextJSLoadBalancer.addListener("Http", {
      port : 80,
      open : true
    })
    Http.addAction("redirect", {
      action : elbv2.ListenerAction.redirect({
        protocol : "HTTPS"
      })
    })
    const Https = NextJSLoadBalancer.addListener('Https', {
      port: 443,
      open: true,
      certificates : [NextJSCertificate],      
    });
    Https.addTargets('application-access', {
      port: 80,
      targets: [NextJSAutoScalingGroup],
      priority : 1,
      conditions : [
        elbv2.ListenerCondition.httpHeader(HeaderName, [HeaderValue])
      ]
    });
    Https.addAction("default", {
      action: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Access Denied',
      }),
    })

    NextJSAutoScalingGroup.scaleOnRequestCount('requests-per-minute', {
      targetRequestsPerMinute: 60,
    });
    NextJSAutoScalingGroup.scaleOnCpuUtilization('cpu-util-scaling', {
      targetUtilizationPercent: 75,
    });

    const NextJSApplication = new codedeploy.ServerApplication(this, "NextJSApplication", {})

    const NextJSDeploymentGroup = new codedeploy.ServerDeploymentGroup(this, "NextJSDeploymentGroup", {
      application : NextJSApplication,   
      autoScalingGroups : [NextJSAutoScalingGroup],
    })

    const NextJSPipeline = new codepipeline.Pipeline(this, "NextJSPipeline", {
      stages : [{
        stageName : "Source",
        actions : [
          new S3SourceAction({
            actionName : "Source",
            bucket : NextJSBucket,
            bucketKey : NextJSProject.projectName,
            output : new codepipeline.Artifact("Source"),            
          })
        ]
      }, {
        stageName : "Deploy",
        actions : [
          new CodeDeployServerDeployAction({
            actionName : "Deploy",
            deploymentGroup : NextJSDeploymentGroup,
            input : new codepipeline.Artifact("Source"),                                  
          })
        ]
      }]
    })

    NextJSPipeline.artifactBucket.grantReadWrite(NextJSAutoScalingGroup) 

    const NextJSDistribution = new cloudfront.Distribution(this, "NextJSDistribution", {
      defaultBehavior : {
        origin :  new origins.HttpOrigin("elb.loganmurphy.us", {
          protocolPolicy : cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          customHeaders : {
            [HeaderName] : HeaderValue
          }
          // originShieldRegion : "us-east-1"          
        }),        
        allowedMethods : cloudfront.AllowedMethods.ALLOW_ALL,
        compress : true,
        cachedMethods : cloudfront.CachedMethods.CACHE_GET_HEAD,
        viewerProtocolPolicy : cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
      enableIpv6 : true,
      httpVersion : cloudfront.HttpVersion.HTTP2,
      priceClass : cloudfront.PriceClass.PRICE_CLASS_ALL,
      certificate : NextJSCertificate,
      domainNames : ["next.loganmurphy.us"]
    })

    // loganmurphy.us
		const NextJSHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "NextJSHostedZone", {
			hostedZoneId : "Z03134683QY493S0RMPB0",
			zoneName : "loganmurphy.us",
		});
    
		const ELBRecord = new route53.ARecord(this, "ELBRecord", {
			recordName : "elb.loganmurphy.us",
			target : route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(NextJSLoadBalancer)),
			zone : NextJSHostedZone,
		});
    
		const NextJSRecord = new route53.ARecord(this, "NextJSRecord", {
			recordName : "next.loganmurphy.us",
			target : route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(NextJSDistribution)),
			zone : NextJSHostedZone,
		});
  }
}
