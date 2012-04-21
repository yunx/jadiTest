"use strict";
exports.jadiTest = function (jadiInstance){
	var jadi = jadiInstance || require("jadi").newInstance();
	
	jadi.clazz("jadi.test.Tester", function Tester(utils){
		var expectedException = undefined;			
		var testResult = {
			pass : undefined,
			error : undefined
		};
		var started = 0;
		var finished = 0;
		return {
			proxy : function proxy(fn){
				var that = this;
				started++;
				return function(){
					try{		
						fn.apply(that,arguments);
						testResult.pass = true;
					}
					catch(e){
						if(!that.expectException(e)){
							testResult.pass = false;
							started = finished = 0;
							return;
						}
						else{
							testResult.pass = true;
						}
					}
					finished++;
				};					
			},
			compare : function(expected, operator, result, message){
				var pass = utils.compare(expected, operator, result);
				if(!pass){
					throw new Error(message || expected + " " + operator + " " + result + " is not true"); 
				}
			},
			exception : function(e){
				expectedException = e;
			},
			expectException : function(e){
				if(expectedException === undefined){
					testResult.error = e;
					return false;
				}
				if(utils.isString(e)){
					return e === expectedException;
				}
				if(utils.isObject(e)){
					return e instanceof expectedException;
				}
				testResult.error = e;
			},
			getResultHolder : function(){
				return function(){
					if(started === finished){
						return testResult;
					}
					return undefined;
				}
			}
		};
	});
	
	jadi.clazz("jadi.test.TestContext",function TestContext(utils, injector, aop){
		var suites = {};
		
		var getCia = function getCreateIfAbsent(obj,name){
			var val = obj[name] || (obj[name]=[]);
			return val;
		}
		return {
			addCase : function(context, path, testCase){
				var suiteName = context.suite || "default";
				var methodParameters = injector.inject({},context.injectMethods);
				var testCase = aop.intercept(testCase,function(obj, methodName){
					var parameters = methodParameters[methodName];
					var method = obj[methodName];
					if(parameters !== undefined){
						return function(){
							return method.apply(this,parameters);
						}
					}
					return method;
				});

				getCia(suites, suiteName).push({
					path : path,
					"case" : testCase
				});
			},
			getSuites : function(){
				return suites;
			}
		};
	});
	
	jadi.clazz("jadi.test.Executor", function Executor(utils, testerFactory, testContext){
		
		return {
			addTestDefinitions : function(testDefinitions){
				for(var name in testDefinitions){
					var def = testDefinitions[name];
					testContext.addCase(def.test, def.path, def.testCase);
				}
				return this;
			},
			executes : function(runMethodPrefix){
				var testResults = {};
				var suites = testContext.getSuites();
				for(var sname in suites){
					var results = testResults[sname] = [];
					var suit = suites[sname];
					for(var i=0; i < suit.length; i++){
						var testCase = suit[i]["case"];
						var path = suit[i]["path"]
						for(var name in testCase){
							if(name === undefined || name.indexOf(runMethodPrefix) !== 0){
								continue;
							}
							var caseMethod = testCase[name];
							if(utils.isFunction(caseMethod)){
								var clazzName = path+"."+name;
								var tester = testerFactory.selfFactory.make();
								tester.proxy(caseMethod)();
								var holder = tester.getResultHolder();
								results.push({
									method : clazzName,
									getResult : holder
								});
							}
						}
					}
				}
				return testResults;
			}
		};
	});
	
	return jadi.plugIn(function(){
		
		function toTestDefinitions(contextFiles){
			var testContext = [];
			for(var i=0; i < contextFiles.length; i++){
				var contextFile = contextFiles[i];
				if(utils.isString(contextFile)){
					var filePath = require('path').resolve(contextFiles[i]);
					var beanDefinitions = require(filePath).beanDefinitions;
				}
				else if(contextFile.path !== undefined){
					var beanDefinitions = [contextFile];
				}				
				for(var j=0; j < beanDefinitions.length; j++){
					var beanDefinition = beanDefinitions[j];
					if(beanDefinition.test !== undefined){
						testContext.push({
							test : beanDefinition.test,
							path : beanDefinition.path,
							testCase : jadi.newInstance(beanDefinition)
						});
					}					
				}
			}
			return testContext;
		}
		
		var label = "Total Test Run Time";
		
		var waitForResult = function(results, next){
			var intervalId = setInterval(function(){
				for(var name in results){
					var result = results[name];
					if(result === undefined){
						continue;
					}
					if(!result.isPrinted){
						console.log(name);
						result.isPrinted = true;
					}					
					for(var i=0; i<result.length; i++){
						var caseResult = result[i];
						if(caseResult === undefined || result.length === 0){
							continue;
						}
						if(caseResult.getResult() === undefined){
							return;
						}
						var finalResult = caseResult.getResult();
						console.log(( finalResult.pass ? "  Pass" : "  Fail") + "   " + caseResult.method);
						if(finalResult.error){
							console.log(finalResult.error.stack);
						}
						delete result[i];
					}
					delete results[name];
				}
				clearInterval(intervalId);
				if(next !== undefined){
					next();
					return;
				}
				console.log("===============================================");
				console.timeEnd(label);
			},100);
		}
		
		var utils = this.utils;
		var container = this;
		jadi.run = function(){
			var testExecutor = jadi.newInstance({
				path : "jadi.test.Executor",
				args : [utils, {
						path : "jadi.test.Tester",
						args : [utils],
						selfFactoryAware : true
					}, 
					{
						path : "jadi.test.TestContext",
						args : [utils, "path:jadi.factory.injector", "path:jadi.aop.Interceptor"]
					}]
			});
			testExecutor.addTestDefinitions(toTestDefinitions(arguments));
			console.time(label);
			var results = testExecutor.executes("setup");
			waitForResult(results, function(){
				var results = testExecutor.executes("test");
				waitForResult(results)
			});
		};
		
		return jadi;
	});
}