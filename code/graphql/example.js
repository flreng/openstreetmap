const { Neo4jGraphQL } = require("@neo4j/graphql");
const { ApolloServer } = require("apollo-server");
const neo4j = require("neo4j-driver");

const driver = neo4j.driver(
  "bolt://<HOST>:<BOLTPORT>",
  neo4j.auth.basic("<USERNAME>", "<PASSWORD>")
);

const typeDefs = /* GraphQL */ `
  type Step @exclude(operations: "*") {
    latitude: Float
    longitude: Float
  }
  type Tag @exclude(operations: "*") {
    key: String
    value: String
  }
  type PointOfInterest @exclude(operations: ["create", "update", "delete"]) {
    name: String
    location: Point
    type: String
    wikipedia: String
      @cypher(
        statement: """
        MATCH (this)-->(t:OSMTags)
        WHERE EXISTS(t.wikipedia) WITH t LIMIT 1
        CALL apoc.load.json('https://en.wikipedia.org/w/api.php?action=parse&prop=text&formatversion=2&format=json&page=' + apoc.text.urlencode(t.wikipedia)) YIELD value
        RETURN value.parse.text
        """
      )
    tags(limit: Int = 10): [Tag]
      @cypher(
        statement: """
        MATCH (this)-->(t:OSMTags) WITH t LIMIT $limit
        UNWIND keys(t) AS key
        RETURN {key: key, value: t[key]} AS tag
        """
      )
    routeToPOI(name: String!): [Step]
      @cypher(
        statement: """
        MATCH (other:PointOfInterest {name: $name})
        CALL gds.beta.shortestPath.dijkstra.stream({
          nodeProjection: 'OSMNode',
            relationshipProjection: {
              ROUTE: {
                  type: 'ROUTE',
                    properties: 'distance',
                    orientation: 'UNDIRECTED'
                }
            },
            sourceNode: id(this),
            targetNode: id(other),
            relationshipWeightProperty: 'distance'
        })
        YIELD nodeIds
        WITH [nodeId IN nodeIds | gds.util.asNode(nodeId)] AS pathNodes
        UNWIND pathNodes AS node
        RETURN {latitude: node.location.latitude, longitude: node.location.longitude} AS route
        """
      )
  }
`;

// Create executable GraphQL schema from GraphQL type definitions,
// using @neo4j/graphql to autogenerate resolvers
const neoSchema = new Neo4jGraphQL({
  typeDefs,
  debug: true,
});

// Create ApolloServer instance that will serve GraphQL schema created above
// Inject Neo4j driver instance into the context object, which will be passed
//  into each (autogenerated) resolver
const server = new ApolloServer({
  context: { driver },
  schema: neoSchema.schema,
  introspection: true,
  playground: true,
});

// Start ApolloServer
server.listen().then(({ url }) => {
  console.log(`GraphQL server ready at ${url}`);
});