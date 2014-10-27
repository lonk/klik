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

	socket.on('speak', function (data) {
		roomRequest(myRoom, 'speak', {message:data.message, pseudo:myRoom.getPlayer(socket).getInfos().pseudo, color:myRoom.getPlayer(socket).getColor() });
	});

	socket.on('killbox', function (data) {
		roomRequest(myRoom, 'killbox', data);
		myRoom.getBox(data.id).kill();

		if(myRoom.getBox(data.id).getColor() == myRoom.getPlayer(socket).getColor()) {
			myRoom.getPlayer(socket).addPoints(1);
		} else if(myRoom.getBox(data.id).getColor() == myRoom.getMalus()) {
			myRoom.getPlayer(socket).rmPoints(3);
			if(myRoom.getPlayer(socket).getPoints() < 0) myRoom.getPlayer(socket).setPoints(0);
		} else if(myRoom.getBox(data.id).getColor() == myRoom.getBonus()) {
			// JAY PAS ENCORE FAY LES POUVOIRS PASKE CAY LONG À FAYRE
		} else {
			myRoom.getPlayer(socket).rmPoints(2);
			if(myRoom.getPlayer(socket).getPoints() < 0) myRoom.getPlayer(socket).setPoints(0);
		}
	});
});

function launchRoom(room) {
	var playersInfos = [];
	for(player in room.getPlayers()) {
		objectPlayer = {pseudo: room.getPlayers()[player].getInfos().pseudo, color: room.getPlayers()[player].getColor()};
		playersInfos.push(objectPlayer);
	}
	roomRequest(room, 'start', playersInfos);

	setTimeout(function() { launchGame(room); }, 10000);
}

function launchGame(room) {
	stepGame(room);
}

function stepGame(room) {
	var blackRandom = Math.floor(Math.random() * 20);
	if(blackRandom == 0 && room.getNbBlack() < 5) var stepColor = room.getMalus();
	else {
		var stepColor = room.getCurrentColor();
		room.nextColor();
	}

	generateBox(room, stepColor);

	if(room.getTime()+2*room.getRatio() >= 30) {
		setTimeout(function() { endGame(room); }, 30-room.getTime());
		room.setTime(30);
	} else {
		setTimeout(function() { stepGame(room); }, 2*room.getRatio()*1000);
		room.setTime(room.getTime()+2*room.getRatio());
		room.nextRatio();
	}
}

function endGame(room) {
	var points = [];
	for(player in room.getPlayers()) {
		points.push({pseudo: room.getPlayers()[player].getInfos().pseudo, points: room.getPlayers()[player].getPoints()});
	}
	roomRequest(room, 'stop', points);
}

function generateBox(room, stepColor) {
	var box = new boxes.Box(room.nextBox(), stepColor);
	room.addBox(box);
	roomRequest(room, 'box', {box: box});
	//console.log(box);
}

function roomRequest(room, type, data) {
	for(index in room.getSockets()) {
		room.getSockets()[index].emit(type, data);
	}
}