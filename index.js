#!/usr/bin/env node
const worker_version = '0.1';
const DDPClient = require("ddp");
const queue = require('queue');
const child_process = require('child_process');
const vm = require('vm');
const path = require('path');
const mkdirp = require('mkdirp');
const os = require('os');
const fs = require('fs');
const argv = require('yargs')
      .default({id : "",
                token : "",
                host: 'ai.pasteur.fr',
                port: 443,
                ssl: true,
                workdir: './dai-workdir',
                dropbox_token: null,
                debug: false,
                concurrency: 10,
                timeout: 10*24*60*60 //10 days maximum
               })
      .argv;

console.log(argv);

const worker_id=argv.id;
const worker_token=argv.token;
const host = argv.host;
const port = argv.port;
const ssl = argv.ssl;
const workdir= path.resolve(argv.workdir);
const debug = argv.debug;
const task_concurrency = argv.concurrency;
const task_timeout = argv.timeout; //10 days maximum
const dropbox_access_token = argv.dropbox_token;

const utils = require('./utils.js');

let dropbox = undefined;
if(dropbox_access_token){
  const Dropbox = require('dropbox');
  dropbox = new Dropbox({ accessToken: dropbox_access_token });
  dropbox.uploadFile = (filePath, uploadPath, chunk_size)=>{
    return utils.dropbox_file_upload(dropbox, filePath, uploadPath, chunk_size);
  };
}

const task_queue = queue();
task_queue.concurrency = task_concurrency;
task_queue.timeout = task_timeout;

// use the timeout feature to deal with tasks that
// take too long or forget to execute a callback
task_queue.on('timeout', function(next, task) {
  console.log('task timed out:', task.toString().replace(/\n/g, ''));
  next();
});
// get notified when tasks complete
task_queue.on('success', function(result, task) {
  console.log('task finished.');
  // console.log('task finished processing:', task.toString().replace(/\n/g, ''));
});

const ddpclient = new DDPClient({
  // All properties optional, defaults shown
  host : host,
  port : port,
  ssl  : ssl,
  autoReconnect : true,
  autoReconnectTimer : 500,
  maintainCollections : true,
  ddpVersion : '1',  // ['1', 'pre2', 'pre1'] available
  // uses the SockJs protocol to create the connection
  // this still uses websockets, but allows to get the benefits
  // from projects like meteorhacks:cluster
  // (for load balancing and service discovery)
  // do not use `path` option when you are using useSockJs
  useSockJs: true,
  // Use a full url instead of a set of `host`, `port` and `ssl`
  // do not set `useSockJs` option if `url` is used
  // url: server_url
});
console.log('connecting...')
/*
 * Connect to the Meteor Server
 */
ddpclient.connect(function(error, wasReconnect) {
  // If autoReconnect is true, this callback will be invoked each time
  // a server connection is re-established
  if (error) {
    console.log('DDP connection error!');
    return;
  }

  if (wasReconnect) {
    console.log('Reestablishment of a connection.');
  }

  console.log('connected!');

  // setTimeout(function () {
  //   /*
  //    * Call a Meteor Method
  //    */
  //   ddpclient.call(
  //     'deletePosts',             // name of Meteor Method being called
  //     ['foo', 'bar'],            // parameters to send to Meteor Method
  //     function (err, result) {   // callback which returns the method call results
  //       console.log('called function, result: ' + result);
  //     },
  //     function () {              // callback which fires when server has finished
  //       console.log('updated');  // sending any updated documents as a result of
  //       console.log(ddpclient.collections.posts);  // calling this method
  //     }
  //   );
  // }, 3000);
      if (!wasReconnect) {
          /*
           * Observe collection widgets.
           */
          const observer_widgets = ddpclient.observe("widgets");
          observer_widgets.added = function(id) {
            console.log("[ADDED] to " + observer_widgets.name + ":  " + id);
            widgets[id] = new Widget(id);
          };
          observer_widgets.changed = function(id, oldFields, clearedFields, newFields) {
            console.log("[CHANGED] in " + observer_widgets.name + ":  " + id);
            //console.log("[CHANGED] old field values: ", oldFields);
            //console.log("[CHANGED] cleared fields: ", clearedFields);
            //console.log("[CHANGED] new fields: ", newFields);
            if('code_snippets' in newFields){
              widgets[id].register();
            }
          };
          observer_widgets.removed = function(id, oldValue) {
            console.log("[REMOVED] in " + observer_widgets.name + ":  " + id);
            if(id in widgets){
              delete widgets[id];
            }
            //console.log("[REMOVED] previous value: ", oldValue);
          };
      }
    if (!wasReconnect) {
       /*
       * Observe collection tasks.
       */
      const observer_tasks = ddpclient.observe("tasks");
      observer_tasks.added = function(id) {
        console.log("[ADDED] to " + observer_tasks.name + ":  " + id);
        if(id in tasks){
            const task = tasks[id];
            if(task.get('status.running')){
                task.set({ 'status.info': 'worker reconnected.'});
            }
            else{
                task.init();
            }
        }
        else{
            const task = new Task(id);
            if(task.widget){
                tasks[id] = task;
                if(task.get('status.running')){
                  task.set({ 'status.error': 'worker restarted unexpectedly'});
                  task.close('aborted');
                }
                else if(task.get('cmd') && task.get('cmd') != ''){
                  task.init();
                  task.execute(task.get('cmd'));
                }
                else{
                  task.init();
                }
            }
            else{
                task.close('aborted');
                console.error('widget not found');
            }
        }
      };
      observer_tasks.changed = function(id, oldFields, clearedFields, newFields) {
        if(debug) console.log("[CHANGED] in " + observer_tasks.name + ":  " + id);
        //console.log("[CHANGED] old field values: ", oldFields);
        //console.log("[CHANGED] cleared fields: ", clearedFields);
        //console.log("[CHANGED] new fields: ", newFields);
        let task;
        if(id in tasks){
          task = tasks[id];
        }
        else{
          task = new Task(id);
        }
        if('cmd' in newFields && newFields['cmd'] != ''){
          task.execute(newFields['cmd']);
        }
      };
      observer_tasks.removed = function(id, oldValue) {
        console.log("[REMOVED] in " + observer_tasks.name + ":  " + id);
        // console.log("[REMOVED] previous value: ", oldValue);
        if(id in tasks){
          try {
            if(tasks[id].$ctrl.close) tasks[id].$ctrl.close();
          } catch (e) {
              console.error(e);
          }
          delete tasks[id];
        }
      };
    }
  /*
   * Subscribe to a Meteor Collection
   */
  ddpclient.subscribe(
    'workers.worker',                  // name of Meteor Publish function to subscribe to
    [worker_id, worker_token],         // any parameters used by the Publish function
    function () {             // callback when the subscription is complete
      console.log('worker subscribed.');
      //console.log(ddpclient.collections.workers);
      if(ddpclient.collections.workers && ddpclient.collections.workers[worker_id]){
        console.log('worker found: '+ ddpclient.collections.workers[worker_id].name);
        task_queue.autostart = true;
        if(wasReconnect){
            console.log("Resuming the task queue...")
            task_queue.start((err)=>{console.log('queue is empty or an error occured')});
        }
        worker_set({status:'ready', version: worker_version, name: os.hostname()+'('+worker_id.slice(0, 4)+')'});
        setInterval(function(){ worker_set({'resources.date_time':new Date().toLocaleString()}); }, 3000);

        ddpclient.subscribe(
          'widgets.worker',                  // name of Meteor Publish function to subscribe to
          [worker_id, worker_token],         // any parameters used by the Publish function
          function (error) {
              if(error)
                console.error(error);
              else
                console.log('widgets subscribed.');
            //console.log(ddpclient.collections.widgets);
            ddpclient.subscribe(
              'tasks.worker',                  // name of Meteor Publish function to subscribe to
              [worker_id, worker_token],       // any parameters used by the Publish function
              function (error) {
                  if(error)
                    console.error(error);
                  else
                    console.log('tasks subscribed.');
                  //console.log(ddpclient.collections.tasks);
            });

        });

      }
      else{
        console.log('ERROR: worker not found.')
        ddpclient.close();
      }
    }
  );

});

function worker_set(v){
  ddpclient.call('workers.update', [worker_id, worker_token, {'$set': v}], function (err, result) {
    if(err) console.error('worker update error:', err);
  });
}

const widgets = {};

function Widget(id){
  this.id = id;
  this.workdir = path.join(workdir, 'widget-' + this.id);
  mkdirp(this.workdir, (err)=>{
    if(err) console.error(err);
    this.register();
  });
};

Widget.prototype.register = function(){
  const code_snippets = this.get('code_snippets');
  const timeout = this.get('config.timeout') || 60000; //ms
  if('WORKER_js' in code_snippets){
    try {
      console.log('widget updated: ' + this.id);
      this.writeCodeFiles();
      for(k in tasks){
        if(tasks[k].widget.id == this.id){
          if(tasks[k].get('status.running'))
              tasks[k].widgetUpdated = true;
          else
              tasks[k].init();
        }

      }
    } catch (e) {
      console.error(e);
    }
  }
  else{
    console.log('WORKER.js not found.');
    this.script = null;
  }
};

Widget.prototype.writeCodeFiles = function(){
    const code_snippets = this.get('code_snippets');
    for(let k in code_snippets){
        fs.writeFile(path.join(this.workdir, code_snippets[k].name), code_snippets[k].content, (err)=>{
            if(err) {
                console.error(err);
            }
        });
    }
}
Widget.prototype.getCode = function(name){
  const key = name.replace(/\./g, '_');
  return ddpclient.collections.widgets[this.id].code_snippets[key].content;
};

Widget.prototype.get = function(key){
  try{
    const keys = key.split('.');
    let v = ddpclient.collections.widgets[this.id];
    for(let i in keys){
      v = v[keys[i]];
    }
    return v;
  }
  catch(e){
    return undefined;
  }
};

const tasks = {};
function Task(id){
  this.id = id;
  this.widget = widgets[this.get('widgetId')];
  this.process = null;
  this.workdir = path.join(workdir, 'widget-' + this.get('widgetId'), 'task-'+this.id);
  if(dropbox) this.dropboxPath = '/widget-' + this.get('widgetId') + '/task-'+ this.id;
  mkdirp(this.workdir, function(err) {
    if(err) console.error(err);
  });
  const $ctrl = {
    widget: this.widget,
    task: this,
    run: null,
    stop: null,
    open: ()=>{},
    close: null
  };
  const context = {
   Buffer: Buffer,
   console: console,
   setTimeout: setTimeout,
   setInterval: setInterval,
   require: require,
    // TODO: remove all these default modules
   fs: fs,
   path: path,
   mkdirp: mkdirp,
   dropbox: dropbox,
   child_process: child_process,
   $ctrl: $ctrl
  }
  this.$ctrl = $ctrl;
  this.context = context;
  this.widgetUpdated = false;
}
Task.prototype.get = function(key){
  try{
    const keys = key.split('.');
    let v = ddpclient.collections.tasks[this.id];
    for(let i in keys){
      v = v[keys[i]];
    }
    return v;
  }
  catch(e){
    return undefined;
  }
}
Task.prototype.set = function(key, value){
  let doc = {};
  if(typeof key == 'object'){
    doc = key;
  }
  else{
    doc[key] = value
  }
  ddpclient.call("tasks.update.worker", [this.id, worker_id, worker_token, {'$set': doc}], function (err, result) {
    if(err) console.error('task set error:', err);
  });
}
Task.prototype.push= function(key, value){
  let doc = {};
  if(typeof key == 'object'){
    doc = key;
  }
  else{
    doc[key] = value
  }
  ddpclient.call("tasks.update.worker", [this.id, worker_id, worker_token, {'$push': doc}], function (err, result) {
    if(err) console.error('task push error:', err);
  });
}
Task.prototype.pull= function(key, value){
  let doc = {};
  if(typeof key == 'object'){
    doc = key;
  }
  else{
    doc[key] = value
  }
  ddpclient.call("tasks.update.worker", [this.id, worker_id, worker_token, {'$pull': doc}], function (err, result) {
    if(err) console.error('task pull error:', err);
  });
}
Task.prototype.addToSet= function(key, value){
  let doc = {};
  if(typeof key == 'object'){
    doc = key;
  }
  else{
    doc[key] = value
  }
  ddpclient.call("tasks.update.worker", [this.id, worker_id, worker_token, {'$addToSet': doc}], function (err, result) {
    if(err) console.error('task addToSet error:', err);
  });
}
Task.prototype.getWidgetCode = function(name){
  return this.widget.getCode(name);
}
Task.prototype.init = function(){
    try {
      this.set({'status.error':'', 'status.info': ''});
      const timeout = this.widget.get('timeout') || 60000;
      const code_snippets = this.widget.get('code_snippets');
      const script = new vm.Script(code_snippets['WORKER_js'].content, {
        filename: code_snippets['WORKER_js'].name, // filename for stack traces
        lineOffset: 0, // line number offset to be used for stack traces
        columnOffset: 0, // column number offset to be used for stack traces
        displayErrors: true,
        timeout: timeout // ms
      });
      script.runInNewContext(this.context, {timeout: timeout});
      console.log('task script updated:', this.id);
    } catch (e) {
      console.error(e);
      this.set('status.error', e.toString());
    }
    this.set({'status.stage':'attached', 'status.info':'','status.error':''});
}
Task.prototype.stop = function(msg){
  const m = {'status.running': false};
  if(!msg || msg.endsWith('ing')){
      msg = 'stopped'
  }
  m['status.stage'] = msg;
  this.set(m);
  if(this.widgetUpdated){
    this.widgetUpdated = false;
    this.init();
  }
}
Task.prototype.close = function(msg){
  const m = {'status.running': false, 'isOpen': false};
  if(!msg || msg.endsWith('ing')){
      msg = 'exited'
  }
  m['status.stage'] =  msg;
  this.set(m);
}
Task.prototype.execute = function(cmd){
  try {
      cmd = cmd || this.get('cmd');
      if(cmd == 'init'){
        this.init();
      }
      else if(cmd == 'run' && !this.get('status.running')){
        if(this.$ctrl.run){
          task_queue.push((cb)=>{try {
            this.set({'status.running': true, 'status.stage': 'running', 'status.error':'', 'status.info':''});
            this.$ctrl.run(cb);
            if(this.$ctrl.process){
                this.$ctrl.process.on('close', (code) => {
                    cb();
                    if(code == 0){
                        msg = 'done';
                    }
                    else{
                        msg = 'exited('+code+')';
                    }
                    this.close(msg);
                    delete this.$ctrl.process;
                });
                this.$ctrl.process.on('error', (err)=>{
                    console.error(err);
                    this.set('status.error', err.toString());
                });
            }
            else{
                console.log('WARNING: no $ctrl.process returned, please call cb() when finished.');
                // cb();
                // this.close();
            }
            if(!this.$ctrl.stop){
                this.$ctrl.stop = ()=>{ cb(); if(this.$ctrl.process){ this.$ctrl.process.kill();} };
            }
            if(!this.$ctrl.close){
                this.$ctrl.close = ()=>{this.$ctrl.stop(); this.close();};
            }
          } catch (e) {
            console.error(e);
            this.set('status.error', e.toString());
            cb();
            this.stop();
          }});
          worker_set({'resources.queue_length': task_queue.length});
        }
        else{
          this.set('status.error', '"$ctrl.run" is not defined.');
        }
      }
      else if(cmd == 'stop'){
        if(this.$ctrl.stop){
          this.$ctrl.stop();
        }
        else{
          this.set('status.info', '"$ctrl.stop" is not defined.');
        }
        this.stop('aborted');
      }
      else{
        if(this.$ctrl[cmd]){
          this.$ctrl[cmd]();
        }
        else{
          this.set('status.info', '"$ctrl.'+cmd+'" is not defined.');
        }
      }
  } catch (e) {
      console.error(e);
      this.set('status.error', e.toString());
  } finally {
      this.set({'cmd': ''});
  }
}
if(dropbox){
  Task.prototype.downloadUrl = function(url, filename){
    // replace for dropbox
    url = url.split("?dl=0").join("?dl=1");
    return new Promise((resolve, reject)=>{
      utils.download(url, path.join(this.workdir, filename), resolve);
    });
  };
  Task.prototype.saveDownloadUrl = function(url, filename){
    return new Promise((resolve, reject)=>{
      // replace for dropbox
      url = url.split("?dl=0").join("?dl=1");
      dropbox.filesSaveUrl({path: this.dropboxPath + '/' + filename, url:url}).then((result)=>{
        console.log(result);
      },(err)=>{
        reject(err);
      });
      this.downloadUrl(url, filename).then(()=>{
        resolve(filename);
      }).catch(function(error) {
        console.log(error);
      });
    });
  };
  Task.prototype.getSharedLink = function(short_url) {
    return new Promise((resolve, reject)=>{
      dropbox.sharingCreateSharedLink({path:this.dropboxPath, short_url:short_url}).then((link)=>{
        console.log(link.url);
        resolve(link);
      },(err)=>{
        reject(err);
      });
    });
  };
  Task.prototype.uploadFile= function(file_name, chunk_size, create_shared_link){
    const file_path = path.join(this.workdir, file_name);
    const upload_file_path = this.dropboxPath + '/' + file_name;
    create_shared_link = create_shared_link || true;
    return new Promise((resolve, reject)=>{
      dropbox.filesGetMetadata({path: this.dropboxPath, include_media_info: false, include_deleted: false})
      .then(function(response) {
          dropbox.uploadFile(file_path, upload_file_path, chunk_size).then(
            (file_meta_data)=>{
              console.log('file uploaded:', file_meta_data);
              if(create_shared_link){
                dropbox.sharingCreateSharedLink({path:file_meta_data.path_lower, short_url:true}).then((link)=>{
                  console.log(link.url);
                  resolve(link);
                },(err)=>{
                  reject(err);
                });
              }
              else{
                resolve(file_meta_data);
              }
            },
            (error)=>{
              reject(error);
            }
          );
      })
      .catch(function(error) {
          dropbox.filesCreateFolder({path: upload_task_dir})
          .then((response)=>{
             dropbox.uploadFile(file_path, upload_file_path, chunk_size).then(
               (file_meta_data)=>{
                 resolve(file_meta_data);
               },
               (error)=>{
                 reject(error);
               }
             );
          })
          .catch(function(error) {
            console.log(error);
          });
      });
    });
  };
}
// /*
//  * If you need to do something specific on close or errors.
//  * You can also disable autoReconnect and
//  * call ddpclient.connect() when you are ready to re-connect.
// */
ddpclient.on('socket-close', function(code, message) {
  console.log("Socket Close: %s %s", code, message);
  task_queue.stop();
  console.log("Task Queue stopped.")
});

ddpclient.on('socket-error', function(error) {
  console.log("Socket Error: %j", error);
  // task_queue.stop();
});

process.on('SIGINT', ()=>{
    console.log("interrupting...");
    worker_set({status:'exit'});
    process.exit();
});

/*
 * Useful for debugging and learning the ddp protocol
 */
 if(debug){
   ddpclient.on('message', function (msg) {
     console.log("ddp message: " + msg);
   });
 }
/*
 * Close the ddp connection. This will close the socket, removing it
 * from the event-loop, allowing your application to terminate gracefully
 */
// ddpclient.close();
