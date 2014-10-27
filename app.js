var app = require('http').createServer(handler);
var io  = require('socket.io').listen(app);
var fs = require('fs');
var players = require('players');
var rooms = require('rooms');
var boxes = require('boxes');

var mysql      = require('mysql');
var config = JSON.parse(fs.readFileSync("./config.json"));
var connection = mysql.createConnection(config);

connection.connect();

app.listen(3000);

function handler (req, res) {
  res.writeHead(200);
  res.end("Koukou !");
}

const roomSize = 2;

var currentRoom = new rooms.Room(roomSize);

io.sockets.on('connection', function (socket) {
	var myRoom = currentRoom;
	socket.on('id', function (data) {
		connection.query("SELECT * FROM members WHERE phpsessid=?", data.id, function(err, rows, fields) {
			if (err) throw err;

			currentRoom.addPlayer(new players.Player(socket), rows[0]);

			socket.emit('connection', {color: currentRoom.getPlayer(socket).getColor(), pseudo: currentRoom.getPlayer(socket).getInfos().pseudo});

			if(currentRoom.isFull()) { 
				currentRoom = new rooms.Room(roomSize);
				roomRequest(myRoom, 'ready', {});
			}
		});

	});

	socket.on('ready', function (data) {
		myRoom.getPlayer(socket).setReady(true);

		if(myRoom.isReady()) {
			setTimeout(function() { launchRoom(myRoom); }, 1000);
		}
	});

	socket.on('speak', function(data) {
		roomRequest(myRoom, 'speak', {message:data.message, pseudo:myRoom.getPlayer(socket).getInfos().pseudo, color:myRoom.getPlayer(socket).getColor() });
	});
});

function launchRoom(room) {
	var playersInfos = [];
	for(player in room.getPlayers()) {
		objectPlayer = {pseudo: room.getPlayers()[player].getInfos().pseudo, color: room.getPlayers()[player].getColor()};
		playersInfos.push(objectPlayer);
	}
	console.log(playersInfos);
	roomRequest(room, 'start', playersInfos);
}

function roomRequest(room, type, data) {
	for(index in room.getSockets()) {
		room.getSockets()[index].emit(type, data);
	}
}