#!/usr/local/bin/node
var notifier = require('node-notifier');
var SlackChannel = (function () {
    function SlackChannel(team, id, name) {
        this._isUpdatingInfo = false;
        this.team = team;
        this.id = id;
        this.name = name;
    }
    SlackChannel.prototype.isUpdatingInfo = function () {
        return this._isUpdatingInfo;
    };
    SlackChannel.prototype.updateInfo = function (connection) {
        var _this = this;
        this._isUpdatingInfo = true;
        connection.reqAPI('channels.info', { channel: this.id }, function (data) {
            _this._isUpdatingInfo = false;
            if (!data.ok)
                return;
            _this.name = data.channel.name;
            _this.unread_count = data.channel.unread_count;
            _this.team.updateChannelListView();
        });
    };
    SlackChannel.prototype.updateHistory = function (connection, view, team) {
        view.contentBox.setContent("");
        view.contentBox.setLabel(team.name + "/" + this.name);
        view.contentBox.log("Loading...");
        connection.reqAPI('channels.history', { channel: this.id }, function (data) {
            if (!data.ok)
                return;
            view.contentBox.setContent("");
            var messages = data.messages.map(function (e) {
                var head = (team.getUserName(e.user) + "          ").substr(0, 10);
                return head + ":" + e.text;
            }).reverse();
            view.contentBox.log(messages.join("\n"));
        });
        this.updateInfo(connection);
    };
    return SlackChannel;
}());
var SlackRTMData = (function () {
    function SlackRTMData() {
    }
    SlackRTMData.getChannelId = function (data) {
        if (data.type === "message") {
            return data.channel;
        }
        return null;
    };
    return SlackRTMData;
}());
var SlackTeam = (function () {
    function SlackTeam(config, tui) {
        this.name = "";
        this.channelList = [];
        this.tui = tui;
        this.name = config[1];
        this.token = config[0];
        this.connection = new SlackTeam.SlackAPI({
            "token": config[0],
            'logging': false,
            'autoReconnect': true
        });
        this.setRTMHandler();
        this.updateChannelList();
        this.updateUserList();
    }
    SlackTeam.prototype.setRTMHandler = function () {
        var _this = this;
        this.connection.on('message', function (data) {
            // TODO: Improve performance (change to append new message only)
            var chName = _this.getChannelNameById(SlackRTMData.getChannelId(data));
            if (chName)
                notifier.notify('New message on ' + _this.name + "/" + chName);
            if (!_this.tui.isTeamFocused(_this))
                return;
            if (_this.currentChannel)
                _this.selectChannel(_this.currentChannel.name);
        });
    };
    SlackTeam.prototype.updateChannelListView = function () {
        for (var _i = 0, _a = this.channelList; _i < _a.length; _i++) {
            var ch = _a[_i];
            if (ch.isUpdatingInfo())
                return;
        }
        log("done: " + this.name);
        var channelSelectorList = [];
        for (var _b = 0, _c = this.channelList; _b < _c.length; _b++) {
            var ch = _c[_b];
            channelSelectorList.push(ch.name + "(" + ch.unread_count + ")");
        }
        if (!this.tui.isTeamFocused(this))
            return;
        this.tui.view.channelBox.setItems(channelSelectorList);
        this.tui.view.screen.render();
    };
    SlackTeam.prototype.updateChannelList = function () {
        var _this = this;
        this.connection.reqAPI('channels.list', { token: this.token }, function (data) {
            if (!data.ok)
                return;
            _this.channelList = data.channels.map(function (e) {
                var ch = new SlackChannel(_this, e.id, e.name);
                ch.updateInfo(_this.connection);
                return ch;
            });
            _this.updateChannelListView();
        });
    };
    SlackTeam.prototype.updateUserList = function () {
        var _this = this;
        this.connection.reqAPI('users.list', { token: this.token }, function (data) {
            if (!data.ok)
                return;
            _this.userList = data.members.map(function (e) {
                return [e.name, e.id];
            });
            _this.userSelectorList = [];
            for (var _i = 0, _a = _this.userList; _i < _a.length; _i++) {
                var t = _a[_i];
                _this.userSelectorList.push(t[0]);
            }
            _this.tui.requestUpdateUserList(_this);
        });
    };
    SlackTeam.prototype.getChannelById = function (channelId) {
        for (var _i = 0, _a = this.channelList; _i < _a.length; _i++) {
            var ch = _a[_i];
            if (ch.id == channelId)
                return ch;
        }
        return null;
    };
    SlackTeam.prototype.getChannelNameById = function (channelId) {
        var ch = this.getChannelById(channelId);
        if (ch)
            return ch.name;
        return null;
    };
    SlackTeam.prototype.getChannelByName = function (channelName) {
        for (var _i = 0, _a = this.channelList; _i < _a.length; _i++) {
            var ch = _a[_i];
            if (ch.name == channelName)
                return ch;
        }
        return null;
    };
    SlackTeam.prototype.getCanonicalChannelName = function (str) {
        return str.replace(/\(.*\)/g, "");
    };
    SlackTeam.prototype.selectChannel = function (channelName) {
        var ch = this.getChannelByName(this.getCanonicalChannelName(channelName));
        if (!ch)
            return;
        this.currentChannel = ch;
        ch.updateHistory(this.connection, this.tui.view, this);
    };
    SlackTeam.prototype.getUserName = function (userID) {
        for (var _i = 0, _a = this.userList; _i < _a.length; _i++) {
            var u = _a[_i];
            if (u[1] === userID)
                return u[0];
        }
        return null;
    };
    SlackTeam.prototype.sendMessage = function (text) {
        if (!this.currentChannel)
            return;
        this.postMessage(this.currentChannel.id, text);
    };
    SlackTeam.prototype.postMessage = function (channelID, text) {
        var data = new Object();
        data.text = text;
        data.channel = channelID;
        data.as_user = true;
        // APIのchat.postMessageを使ってメッセージを送信する
        this.connection.reqAPI("chat.postMessage", data);
    };
    return SlackTeam;
}());
SlackTeam.SlackAPI = require('slackbotapi');
var SlackTUIView = (function () {
    function SlackTUIView(tui) {
        var _this = this;
        this.tui = tui;
        var blessed = require('blessed');
        // Create a screen object.
        this.screen = blessed.screen({
            smartCSR: true,
            fullUnicode: true,
            dockBorders: true
        });
        this.screen.title = 'slack-tui';
        this.teamBox = blessed.list({
            top: 0,
            left: 0,
            width: '25%',
            height: '25%+1',
            tags: true,
            border: {
                type: 'line'
            },
            label: ' Teams ',
            style: {
                border: {
                    fg: '#f0f0f0'
                },
                selected: {
                    bg: 'red'
                },
                focus: {
                    border: {
                        fg: '#00ff00'
                    }
                }
            },
            keys: true
        });
        this.screen.append(this.teamBox);
        this.channelBox = blessed.list({
            top: '25%',
            left: 0,
            width: '25%',
            height: '25%+1',
            tags: true,
            border: {
                type: 'line'
            },
            style: {
                //fg: 'white',
                //bg: 'magenta',
                border: {
                    fg: '#f0f0f0'
                },
                selected: {
                    bg: 'red'
                },
                focus: {
                    border: {
                        fg: '#00ff00'
                    }
                }
            },
            label: ' Channels ',
            keys: true
        });
        this.screen.append(this.channelBox);
        this.userBox = blessed.list({
            top: '50%',
            left: 0,
            width: '25%',
            height: '50%',
            tags: true,
            border: {
                type: 'line'
            },
            style: {
                //fg: 'white',
                //bg: 'magenta',
                border: {
                    fg: '#f0f0f0'
                },
                selected: {
                    bg: 'red'
                },
                focus: {
                    border: {
                        fg: '#00ff00'
                    }
                }
            },
            label: ' Users ',
            keys: true
        });
        this.screen.append(this.userBox);
        this.contentBox = blessed.log({
            top: 0,
            left: '25%',
            width: '75%',
            height: '80%+1',
            content: "\n{green-bg}Welcome to SlackTUI!{/green-bg}\nUse {red-fg}Tab{/red-fg} key to move box focus.\nUse cursor keys to choose item.\n\t\t\t",
            tags: true,
            border: {
                type: 'line'
            },
            style: {
                border: {
                    fg: '#f0f0f0'
                },
                focus: {
                    border: {
                        fg: '#00ff00'
                    }
                }
            },
            keys: true,
            scrollable: true
        });
        this.screen.append(this.contentBox);
        this.inputBox = blessed.textbox({
            top: '80%',
            left: '25%',
            width: '75%',
            height: '20%+1',
            content: 'Hello {bold}world{/bold}!',
            tags: true,
            border: {
                type: 'line'
            },
            style: {
                fg: 'white',
                border: {
                    fg: '#f0f0f0'
                },
                focus: {
                    border: {
                        fg: '#00ff00'
                    }
                }
            },
            keys: true
        });
        this.screen.append(this.inputBox);
        this.inputBox.on('submit', function (text) {
            _this.inputBox.clearValue();
            _this.inputBox.cancel();
            _this.tui.sendMessage(text);
        });
        this.teamBox.on('select', function (el, selected) {
            var teamName = _this.tui.getCanonicalTeamName(el.getText());
            _this.tui.focusTeamByName(teamName);
        });
        this.channelBox.on('select', function (el, selected) {
            //contentBox.log(el.getText());
            _this.tui.focusedTeam.selectChannel(el.getText());
        });
        this.screen.key(['C-c'], function (ch, key) {
            return process.exit(0);
        });
        this.screen.key(['t'], function (ch, key) {
            _this.teamBox.focus();
        });
        this.teamBox.key(['tab'], function (ch, key) {
            _this.channelBox.focus();
        });
        this.channelBox.key(['tab'], function (ch, key) {
            _this.inputBox.focus();
        });
        this.inputBox.key(['tab'], function (ch, key) {
            _this.contentBox.focus();
        });
        this.contentBox.key(['tab'], function (ch, key) {
            _this.teamBox.focus();
        });
        this.teamBox.focus();
        this.screen.render();
    }
    return SlackTUIView;
}());
var SlackTUI = (function () {
    function SlackTUI() {
        this.fs = require("fs");
        this.configFile = process.env[process.platform == "win32" ? "USERPROFILE" : "HOME"]
            + "/.teamlist.json";
        this.tokenList = [];
        this.teamDict = {};
        this.focusedTeam = null;
        this.view = new SlackTUIView(this);
        try {
            var fval = this.fs.readFileSync(this.configFile);
            this.tokenList = JSON.parse(fval);
        }
        catch (e) {
            this.view.contentBox.log("Error: failed to read " + this.configFile);
            this.view.contentBox.log("Please read https://github.com/hikalium/slack-tui/blob/master/README.md carefully.");
        }
        this.refreshTeamList();
    }
    SlackTUI.prototype.getCanonicalTeamName = function (str) {
        return str.replace(/\(.*\)/g, "");
    };
    SlackTUI.prototype.refreshTeamList = function () {
        var teamSelectorList = [];
        for (var _i = 0, _a = this.tokenList; _i < _a.length; _i++) {
            var t = _a[_i];
            teamSelectorList.push(t[1] + "(*)");
            var team = new SlackTeam(t, this);
            this.teamDict[t[1]] = team;
        }
        this.view.teamBox.setItems(teamSelectorList);
        this.view.screen.render();
    };
    SlackTUI.prototype.isTeamFocused = function (team) {
        return (this.focusedTeam === team);
    };
    SlackTUI.prototype.requestUpdateUserList = function (team) {
        if (!this.isTeamFocused(team))
            return;
        if (!team.userSelectorList)
            return;
        this.view.userBox.setItems(team.userSelectorList);
        this.view.screen.render();
    };
    SlackTUI.prototype.requestLogToContentBox = function (team, data) {
        if (!this.isTeamFocused(team))
            return;
        this.view.contentBox.log(data);
        //this.screen.render();
    };
    SlackTUI.prototype.requestClearContentBox = function (team) {
        if (!this.isTeamFocused(team))
            return;
        this.view.contentBox.setContent("");
    };
    SlackTUI.prototype.requestSetLabelOfContentBox = function (team, label) {
        if (!this.isTeamFocused(team))
            return;
        this.view.contentBox.setLabel(" " + label + " ");
        this.view.contentBox.render();
    };
    SlackTUI.prototype.focusTeamByName = function (teamName) {
        if (!this.teamDict[teamName])
            return;
        this.focusedTeam = this.teamDict[teamName];
        this.focusedTeam.updateChannelListView();
        this.requestUpdateUserList(this.focusedTeam);
    };
    SlackTUI.prototype.sendMessage = function (text) {
        if (!this.focusedTeam)
            return;
        this.focusedTeam.sendMessage(text);
    };
    return SlackTUI;
}());
var slackTUI = new SlackTUI();
var log = function (str) {
    slackTUI.view.contentBox.log(str);
};
