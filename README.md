# Node.js Toolkits for AILab platform (WIP)

# Installation


```bash
git clone https://github.com/oeway/AILabNode.git
cd AILabNode

# skip the following command if have node.js installed, gcc/4.9 is required
sh install_node.sh

npm install
```

# Getting Start
You need to login to AILab.AI platform and then goto "Widget Workers", create a new worker, and get the id and token.

As an example, we get a worker `id=iJX99fYEdfasigEAd` and `token=jguogvqlerkygcc`. You need to edit the corresponding values `worker_id` and `worker_token` in the file named `index.js`.

Then, to run the actual worker, you can open a terminal window and type the following commands:
```bash
# start worker
node index.js
```

And you will see the worker running on the platform, now you are ready to go, try to create a widget and add the worker you just created. In the "Code" tab in a widget editor, you can add one code file named "worker.js" with the type "javascript" which will perform the actuall task on the worker node.

```js
const cmd = 'python';
const args = ['-c', 'print("hello world")'];

const process = $ctrl.child_process.spawn(cmd, args, {cwd:$ctrl.task.workdir});
process.stdout.on('data', (data)=>{
  console.log(data.toString());
  // parse the console output here
  $ctrl.task.set({'status.info': data.toString()});
});

$ctrl.task.init(process);
```

# The real-time 3-way binding of the `$ctrl.task` object
To enable a simple seamless communication between the web GUI and the worker, AILab has an javascript object which is synchronized in realtime between the web GUI and the worker, which can be access with `$ctrl.task`. It's a json object with the following structure:
```json
{
"name": "my task",
"config": {},
"input": {},
"output": {},
"status": {
  "stage":"loading",
  "progress": 55,
  "running": true,
  "info": "",
  "error": ""
  }
}
```
Generally, you can change any of the above fields by using `$ctrl.task.set(key, value)` syntax as you want, but they are designed for different purpose. Here is a general guide for using these fields:
 * use `$ctrl.task.config` for saving and updating settings, configurations of the task.
 * use `$ctrl.task.input` for the input of the task, usually, it can be a file path, an url, some numbers or string which generate by another task.
 * use `$ctrl.task.output` for the output of the task, it can be a file path or url, some numbers or string produced by the task.
 * the fields in `$ctrl.task.status` is fixed and they are linked to the default GUI, so for example, you can change `$ctrl.task.status.progress` to change the display a progress bar showed in your task. Similarly, you can show some infomation or error message with `$ctrl.task.status.info` and `$ctrl.task.status.error`.
 * use `$ctrl.task.set(key, value)` to set one field, for example: `$ctrl.task.set("status.progress", 45);`.
 * use `$ctrl.task.set({key1:value1, key2:value2})` to set multiple fields, for example `$ctrl.task.set({"status.error":"open file error", "input.file": "XX.png"})`
 * use `$ctrl.task.get(key)` syntax to get value, for example: `var x = $ctrl.task.get("config.x");`
 
Once you set the variables, it will be synchronized across all the web pages and the worker in real-time, it's a reactive 3-way binding.


